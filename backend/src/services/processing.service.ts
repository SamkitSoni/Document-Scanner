import type { Document } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { FailureReason, type ValidationIssue } from '../common/types.js';
import { env } from '../config/env.js';
import { documentLogger } from '../config/logger.js';
import { jobQueue } from '../config/queue.js';
import { classify, classifyThrown, type Classification } from '../processing/error-classifier.js';
import { mockProcessor, type DocumentProcessor } from '../processing/mock-processor.js';
import { validateExtractedData } from '../processing/validator.js';
import * as documentsRepo from '../repositories/documents.repo.js';

/**
 * The processing state machine.
 *
 * One document, one attempt: the queue has already claimed the row and moved it
 * to PROCESSING, so this function's only job is to decide which terminal state
 * (or retry) that attempt earns, and to write it together with its history
 * event in a single transaction.
 *
 * Nothing here knows about HTTP, and nothing here polls — that is the worker's
 * concern. Keeping the two apart is what makes a full lifecycle testable
 * without starting a loop.
 */

export type ProcessingResult =
  | { status: 'PROCESSED' }
  | { status: 'VALIDATION_FAILED'; issues: ValidationIssue[] }
  | { status: 'FAILED'; reason: string }
  | { status: 'RETRY_PENDING'; reason: string; retryInMs: number };

/**
 * Exponential backoff with jitter: 2s, 4s, 8s, each ±25%.
 *
 * The jitter is not decoration. A burst of documents failing together — the
 * usual case, since they fail because a shared dependency is unhealthy — would
 * otherwise retry in perfect lockstep and recreate the same load spike that
 * caused the failure. Spreading them out is what lets a struggling dependency
 * recover.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 2_000 * 2 ** (attempt - 1);
  const jitter = base * 0.25 * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/** Only the fields worth logging — never extracted values, which are document contents. */
function logSafeData(data: unknown): { fields: string[] } {
  if (!data || typeof data !== 'object') return { fields: [] };
  return { fields: Object.keys(data as Record<string, unknown>) };
}

export interface ProcessOptions {
  processor?: DocumentProcessor;
  /** Injectable for deterministic backoff in tests. */
  random?: () => number;
}

/**
 * Runs one processing attempt against an already-claimed document.
 *
 * `document.attemptCount` has been incremented by the claim, so it is the
 * number of *this* attempt.
 */
export async function processDocument(
  document: Document,
  options: ProcessOptions = {},
): Promise<ProcessingResult> {
  const processor = options.processor ?? mockProcessor;
  const attempt = document.attemptCount;
  const log = documentLogger(document.id).child({ attempt });

  log.info(
    { documentType: document.documentType, status: 'PROCESSING' },
    'processing attempt started',
  );

  let result: Awaited<ReturnType<DocumentProcessor['extract']>>;
  try {
    result = await processor.extract({
      documentId: document.id,
      filename: document.filename,
      contentHash: document.contentHash,
    });
  } catch (err) {
    // The processor itself threw — a bug or an unhandled transport fault.
    // Treated as a retryable processor error rather than crashing the worker.
    log.error({ err }, 'processor threw');
    return finishFailure(document, attempt, classifyThrown(), options);
  }

  if (result.outcome === 'SUCCESS' || result.outcome === 'INVALID_RESULT') {
    const validation = validateExtractedData(result.data);

    if (!validation.valid) {
      // The processor returned something; the content is wrong. Terminal, and
      // deliberately not retried: the same bytes yield the same bad extraction.
      log.warn(
        {
          status: 'VALIDATION_FAILED',
          reason: FailureReason.EXTRACTED_DATA_INVALID,
          // Rule ids and field names only — never the offending values.
          failedRules: validation.issues.map((i) => `${i.field}:${i.rule}`),
          durationMs: result.durationMs,
        },
        'extracted data failed validation',
      );

      await documentsRepo.applyTransition({
        documentId: document.id,
        status: 'VALIDATION_FAILED',
        attempt,
        reason: FailureReason.EXTRACTED_DATA_INVALID,
        extractedData: result.data as Prisma.InputJsonValue,
        validationErrors: validation.issues as unknown as Prisma.InputJsonValue,
        nextAttemptAt: null,
        detail: { issueCount: validation.issues.length },
      });

      return { status: 'VALIDATION_FAILED', issues: validation.issues };
    }

    log.info(
      {
        status: 'PROCESSED',
        durationMs: result.durationMs,
        ...logSafeData(validation.data),
      },
      'document processed',
    );

    await documentsRepo.applyTransition({
      documentId: document.id,
      status: 'PROCESSED',
      attempt,
      reason: null,
      extractedData: validation.data as unknown as Prisma.InputJsonValue,
      validationErrors: null,
      nextAttemptAt: null,
      detail: { durationMs: result.durationMs },
    });

    return { status: 'PROCESSED' };
  }

  return finishFailure(document, attempt, classify(result.outcome), options, result.durationMs);
}

/**
 * Applies a failed attempt: schedule another one if the failure is retryable
 * and the budget allows, otherwise settle into a terminal state.
 */
async function finishFailure(
  document: Document,
  attempt: number,
  classification: Classification,
  options: ProcessOptions,
  durationMs?: number,
): Promise<ProcessingResult> {
  const log = documentLogger(document.id).child({ attempt });
  const attemptsRemain = attempt < env.MAX_PROCESSING_ATTEMPTS;
  const willRetry = classification.retryable && attemptsRemain;

  if (willRetry) {
    const retryInMs = backoffMs(attempt, options.random);
    const nextAttemptAt = new Date(Date.now() + retryInMs);

    log.warn(
      {
        status: 'RETRY_PENDING',
        reason: classification.reason,
        retryInMs,
        nextAttemptAt: nextAttemptAt.toISOString(),
        attemptsRemaining: env.MAX_PROCESSING_ATTEMPTS - attempt,
        ...(durationMs !== undefined ? { durationMs } : {}),
      },
      'processing attempt failed; retry scheduled',
    );

    // The FAILED event is recorded first so the history reads as it happened:
    // this attempt failed, and then a retry was scheduled. Without it the user
    // would see a retry with no visible cause.
    await documentsRepo.applyTransition({
      documentId: document.id,
      status: 'FAILED',
      attempt,
      reason: classification.reason,
      nextAttemptAt: null,
      detail: { willRetry: true, retryInMs },
    });

    await documentsRepo.applyTransition({
      documentId: document.id,
      status: 'RETRY_PENDING',
      attempt,
      reason: classification.reason,
      nextAttemptAt,
      detail: { retryInMs, attemptsRemaining: env.MAX_PROCESSING_ATTEMPTS - attempt },
    });

    return { status: 'RETRY_PENDING', reason: classification.reason, retryInMs };
  }

  // No retry: either the failure is deterministic, or the budget is spent.
  const terminalReason =
    classification.retryable && !attemptsRemain
      ? FailureReason.ATTEMPTS_EXHAUSTED
      : classification.reason;

  log.error(
    {
      status: classification.terminalStatus,
      reason: terminalReason,
      // The reason the *last* attempt failed, which ATTEMPTS_EXHAUSTED hides.
      lastFailure: classification.reason,
      attemptsUsed: attempt,
      retryable: classification.retryable,
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
    'document failed terminally',
  );

  await documentsRepo.applyTransition({
    documentId: document.id,
    status: classification.terminalStatus,
    attempt,
    reason: terminalReason,
    nextAttemptAt: null,
    detail: { lastFailure: classification.reason, attemptsUsed: attempt },
  });

  return { status: 'FAILED', reason: terminalReason };
}

/**
 * Claims the next due document and processes it. Returns false when the queue
 * is empty, which is how the worker decides whether to keep draining or sleep.
 */
export async function processNextDocument(options: ProcessOptions = {}): Promise<boolean> {
  const document = await jobQueue.claimNext();
  if (!document) return false;

  // The claim moved the row to PROCESSING in one statement; the matching
  // history event is written here, immediately after.
  await documentsRepo.recordClaimEvent(document.id, document.attemptCount);

  try {
    await processDocument(document, options);
  } catch (err) {
    // A failure *outside* the processor — a database blip, say. The document
    // must not be left stranded in PROCESSING, so it is settled here; if even
    // this write fails, the stale-job reaper is the backstop.
    documentLogger(document.id)
      .child({ attempt: document.attemptCount })
      .error({ err }, 'processing pipeline threw');

    try {
      await finishFailure(document, document.attemptCount, classifyThrown(), options);
    } catch (settleErr) {
      documentLogger(document.id).error(
        { err: settleErr },
        'could not settle document after failure; the reaper will reclaim it',
      );
    }
  }

  return true;
}

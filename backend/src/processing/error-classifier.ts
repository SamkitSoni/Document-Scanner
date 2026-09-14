import { FailureReason, type FailureReasonCode } from '../common/types.js';
import type { ProcessorOutcome } from './mock-processor.js';

/**
 * Turns a processor outcome into a retry decision.
 *
 * The distinction that matters: a *transport* failure (the processor broke)
 * says nothing about the document and is worth retrying, whereas a *content*
 * failure is deterministic — the same bytes fed to the same processor produce
 * the same bad output, so retrying only burns the budget and delays the moment
 * a human is told something is wrong.
 */
export interface Classification {
  /** Whether another automatic attempt could plausibly succeed. */
  retryable: boolean;
  /** Stable code written to the document and the event log. */
  reason: FailureReasonCode;
  /** Terminal status to apply once no attempts remain (or immediately, if not retryable). */
  terminalStatus: 'FAILED' | 'VALIDATION_FAILED';
}

export function classify(outcome: Exclude<ProcessorOutcome, 'SUCCESS'>): Classification {
  switch (outcome) {
    case 'TIMEOUT':
      // Transient by nature: a slow downstream or resource contention.
      return {
        retryable: true,
        reason: FailureReason.PROCESSOR_TIMEOUT,
        terminalStatus: 'FAILED',
      };
    case 'ERROR':
      // Cause unknown. Treated as transient, which is the conservative default:
      // retrying a permanent error costs three attempts, whereas not retrying a
      // transient one fails a document that would have succeeded.
      return {
        retryable: true,
        reason: FailureReason.PROCESSOR_ERROR,
        terminalStatus: 'FAILED',
      };
    case 'INVALID_RESULT':
      // The processor worked; the content is bad. Deterministic, so no retry.
      return {
        retryable: false,
        reason: FailureReason.EXTRACTED_DATA_INVALID,
        terminalStatus: 'VALIDATION_FAILED',
      };
  }
}

/** An unexpected exception inside the worker — treated as a retryable processor error. */
export function classifyThrown(): Classification {
  return {
    retryable: true,
    reason: FailureReason.PROCESSOR_ERROR,
    terminalStatus: 'FAILED',
  };
}

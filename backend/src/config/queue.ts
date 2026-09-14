import type { Document, Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { env } from './env.js';

/**
 * The work queue.
 *
 * There is no Redis and no BullMQ: the `documents` table *is* the queue. The
 * row already carries `status` and `attempt_count`; `next_attempt_at` and
 * `locked_at` are what turn it into a work queue. The decisive advantage is
 * transactional integrity — claiming a job and changing document state are the
 * same write, so "did this job run?" always has exactly one answer, whereas an
 * external queue leaves two systems that can disagree after a crash.
 *
 * Everything the worker needs sits behind this interface, so swapping in SQS or
 * BullMQ at higher scale would not touch the worker's domain logic.
 */
export interface JobQueue {
  /** Atomically take the next due document and mark it PROCESSING. */
  claimNext(): Promise<Document | null>;
  /** Number of documents waiting to be claimed. */
  depth(): Promise<number>;
  /** Reclaim documents whose lease has expired (the crash-recovery path). */
  reclaimExpired(leaseTimeoutMs: number): Promise<string[]>;
}

/** A transaction-scoped Prisma client, so callers can compose with their own transaction. */
export type TxClient = Prisma.TransactionClient;

/**
 * Raw shape returned by `$queryRaw`.
 *
 * This is the one place the snake_case database columns are visible: Prisma's
 * camelCase mapping is a feature of its query builder, and a raw statement
 * bypasses it entirely. The claim has to be raw — `FOR UPDATE SKIP LOCKED` has
 * no representation in the query builder — so the mapping is done explicitly
 * here, and nothing downstream ever sees a database column name.
 */
interface DocumentRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  document_type: Document['documentType'];
  content_hash: string;
  storage_key: string;
  status: Document['status'];
  attempt_count: number;
  next_attempt_at: Date | null;
  locked_at: Date | null;
  failure_reason: string | null;
  extracted_data: Prisma.JsonValue;
  validation_errors: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  file_data: Uint8Array | null;
  created_at: Date;
  updated_at: Date;
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    documentType: row.document_type,
    contentHash: row.content_hash,
    storageKey: row.storage_key,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lockedAt: row.locked_at,
    failureReason: row.failure_reason,
    extractedData: row.extracted_data,
    validationErrors: row.validation_errors,
    metadata: row.metadata,
    // Same Bytes/Uint8Array boundary normalisation as the repository layer.
    fileData: row.file_data ? new Uint8Array(row.file_data) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class PostgresQueue implements JobQueue {
  /**
   * `FOR UPDATE SKIP LOCKED` is what makes this correct under concurrency: two
   * workers running this statement at the same instant cannot claim the same
   * row, because the second skips the row the first has locked and takes the
   * next one instead. The claim, the status change and the attempt increment
   * are one statement, so there is no window in which a document is claimed but
   * not marked PROCESSING.
   */
  async claimNext(): Promise<Document | null> {
    const rows = await prisma.$queryRaw<DocumentRow[]>`
      UPDATE documents
      SET status = 'PROCESSING',
          locked_at = NOW(),
          attempt_count = attempt_count + 1,
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM documents
        WHERE status IN ('UPLOADED', 'RETRY_PENDING')
          AND next_attempt_at IS NOT NULL
          AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `;

    const row = rows[0];
    return row ? toDocument(row) : null;
  }

  async depth(): Promise<number> {
    return prisma.document.count({
      where: {
        status: { in: ['UPLOADED', 'RETRY_PENDING'] },
        nextAttemptAt: { lte: new Date() },
      },
    });
  }

  /**
   * Crash recovery. A worker killed mid-processing leaves its document in
   * PROCESSING with a stale `locked_at` and no one working on it. Rather than
   * tracking worker liveness, the lease is allowed to expire and the document
   * becomes claimable again — the attempt it consumed still counts, so a
   * document that repeatedly kills its worker cannot loop forever.
   *
   * Returns the reclaimed ids so the caller can write their history events.
   */
  async reclaimExpired(leaseTimeoutMs: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - leaseTimeoutMs);

    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE documents
      SET status = 'RETRY_PENDING',
          locked_at = NULL,
          next_attempt_at = NOW(),
          updated_at = NOW()
      WHERE id IN (
        SELECT id FROM documents
        WHERE status = 'PROCESSING'
          AND locked_at IS NOT NULL
          AND locked_at < ${cutoff}
          AND attempt_count < ${env.MAX_PROCESSING_ATTEMPTS}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;

    return rows.map((r) => r.id);
  }
}

/**
 * Documents whose lease expired *and* whose attempts are spent cannot be
 * reclaimed — they are finished off as terminally FAILED instead, so nothing is
 * left stuck in PROCESSING forever.
 */
export async function findExhaustedStaleIds(leaseTimeoutMs: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - leaseTimeoutMs);

  const rows = await prisma.document.findMany({
    where: {
      status: 'PROCESSING',
      lockedAt: { lt: cutoff },
      attemptCount: { gte: env.MAX_PROCESSING_ATTEMPTS },
    },
    select: { id: true },
  });

  return rows.map((r) => r.id);
}

export const jobQueue: JobQueue = new PostgresQueue();

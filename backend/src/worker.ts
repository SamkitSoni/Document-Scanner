import { FailureReason } from './common/types.js';
import { disconnectDb, prisma } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { findExhaustedStaleIds, jobQueue } from './config/queue.js';
import * as documentsRepo from './repositories/documents.repo.js';
import { processNextDocument } from './services/processing.service.js';

/**
 * Worker entrypoint.
 *
 * A poll loop rather than a push subscription: the queue is a Postgres table,
 * so there is nothing to subscribe to. The cost is up to one poll interval of
 * latency before a new document is picked up, which is immaterial next to the
 * processing time itself.
 *
 * Two loops run side by side:
 *   - the poll loop, which drains due documents up to `WORKER_CONCURRENCY`;
 *   - the reaper, which reclaims documents whose lease has expired because the
 *     worker holding them died.
 */

let running = false;
let pollTimer: NodeJS.Timeout | undefined;
let reaperTimer: NodeJS.Timeout | undefined;

/** In-flight attempts, awaited on shutdown so nothing is abandoned mid-write. */
const inFlight = new Set<Promise<unknown>>();

function track(promise: Promise<unknown>): void {
  inFlight.add(promise);
  void promise.finally(() => inFlight.delete(promise));
}

/**
 * Keeps up to `WORKER_CONCURRENCY` attempts running at once, and returns only
 * when the queue is drained and every slot is idle.
 *
 * Draining rather than taking a single document per tick means a backlog is
 * worked through at processing speed instead of one document per poll interval.
 * A slot that finds the queue empty stops refilling; the tick ends when the
 * last one does, and the next poll starts the cycle again.
 */
async function drain(): Promise<void> {
  let queueEmpty = false;

  // One long-lived promise per slot: each claims and processes documents back
  // to back until the queue reports empty.
  const slot = async (): Promise<void> => {
    while (running && !queueEmpty) {
      const claimed = await processNextDocument();
      if (!claimed) {
        queueEmpty = true;
        return;
      }
    }
  };

  const slots = Array.from({ length: env.WORKER_CONCURRENCY }, () => {
    const promise = slot();
    track(promise);
    return promise;
  });

  // allSettled, not all: one slot throwing must not abandon the others
  // mid-write. processNextDocument already settles its own document.
  const outcomes = await Promise.allSettled(slots);
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      logger.error({ err: outcome.reason }, 'worker slot failed');
    }
  }
}

/**
 * Crash recovery.
 *
 * A worker killed mid-processing leaves its document in PROCESSING with nobody
 * working on it. Rather than tracking worker liveness — which needs heartbeats
 * and a registry — the claim carries a lease, and a document whose lease has
 * aged out is simply made claimable again. The attempt it consumed still counts,
 * so a document that reliably kills its worker cannot loop forever: it exhausts
 * its budget and is failed terminally by the second half of this function.
 */
async function reap(): Promise<void> {
  try {
    const reclaimed = await jobQueue.reclaimExpired(env.JOB_LEASE_TIMEOUT_MS);

    for (const documentId of reclaimed) {
      logger.warn(
        { documentId, reason: FailureReason.LEASE_EXPIRED, leaseMs: env.JOB_LEASE_TIMEOUT_MS },
        'reclaimed document with an expired lease',
      );
      await prisma.documentEvent.create({
        data: {
          documentId,
          status: 'RETRY_PENDING',
          reason: FailureReason.LEASE_EXPIRED,
          detail: { reclaimedAfterMs: env.JOB_LEASE_TIMEOUT_MS },
        },
      });
    }

    // Stale *and* out of attempts: cannot be retried, must not stay stuck.
    const exhausted = await findExhaustedStaleIds(env.JOB_LEASE_TIMEOUT_MS);

    for (const documentId of exhausted) {
      logger.error(
        { documentId, reason: FailureReason.LEASE_EXPIRED },
        'document abandoned with no attempts remaining; failing terminally',
      );
      await documentsRepo.applyTransition({
        documentId,
        status: 'FAILED',
        attempt: env.MAX_PROCESSING_ATTEMPTS,
        reason: FailureReason.ATTEMPTS_EXHAUSTED,
        nextAttemptAt: null,
        detail: { lastFailure: FailureReason.LEASE_EXPIRED },
      });
    }
  } catch (err) {
    // The reaper is a background safety net; a failed sweep must never take the
    // worker down. The next sweep tries again.
    logger.error({ err }, 'reaper sweep failed');
  }
}

export async function startWorker(): Promise<void> {
  if (running) return;
  running = true;

  await prisma.$connect();
  logger.info(
    {
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      concurrency: env.WORKER_CONCURRENCY,
      maxAttempts: env.MAX_PROCESSING_ATTEMPTS,
      leaseTimeoutMs: env.JOB_LEASE_TIMEOUT_MS,
      mockMode: env.MOCK_PROCESSOR_MODE,
    },
    'worker started',
  );

  const tick = async (): Promise<void> => {
    if (!running) return;
    try {
      await drain();
    } catch (err) {
      logger.error({ err }, 'poll tick failed');
    }
    if (!running) return;
    pollTimer = setTimeout(() => void tick(), env.WORKER_POLL_INTERVAL_MS);
  };

  const reaperTick = async (): Promise<void> => {
    if (!running) return;
    await reap();
    if (!running) return;
    reaperTimer = setTimeout(() => void reaperTick(), env.REAPER_INTERVAL_MS);
  };

  void tick();
  // One sweep on boot: a crash leaves stale leases that should be recovered
  // immediately, not one reaper interval later.
  void reaperTick();
}

/**
 * Stops claiming new work and waits for in-flight attempts to finish writing
 * their terminal state, so a deploy does not strand documents in PROCESSING.
 */
export async function stopWorker(): Promise<void> {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
  if (reaperTimer) clearTimeout(reaperTimer);

  if (inFlight.size > 0) {
    logger.info({ inFlight: inFlight.size }, 'waiting for in-flight documents');
    await Promise.allSettled([...inFlight]);
  }
}

// Only self-start when run directly, not when imported by the API process.
const isDirectRun = process.argv[1]?.includes('worker');

if (isDirectRun) {
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    await stopWorker();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  startWorker().catch((err) => {
    logger.fatal({ err }, 'failed to start worker');
    process.exit(1);
  });
}

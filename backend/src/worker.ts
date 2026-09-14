import { disconnectDb, prisma } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

let running = false;
let timer: NodeJS.Timeout | undefined;

/**
 * Worker entrypoint.
 *
 * Phase 3 fills in the polling loop: claim a due document with a single atomic
 * `UPDATE ... FOR UPDATE SKIP LOCKED`, run extraction and validation, then
 * write the terminal state and its event in one transaction. The stale-job
 * reaper reclaims documents whose lease has expired.
 *
 * For now it verifies connectivity and idles, so `docker compose up` brings a
 * complete, healthy topology.
 */
export async function startWorker(): Promise<void> {
  if (running) return;
  running = true;

  await prisma.$connect();
  logger.info(
    {
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      concurrency: env.WORKER_CONCURRENCY,
      mockMode: env.MOCK_PROCESSOR_MODE,
    },
    'worker started',
  );

  const tick = async (): Promise<void> => {
    if (!running) return;
    // TODO(phase 3): claimNext() → process → complete | scheduleRetry
    timer = setTimeout(() => void tick(), env.WORKER_POLL_INTERVAL_MS);
  };

  void tick();
}

export async function stopWorker(): Promise<void> {
  running = false;
  if (timer) clearTimeout(timer);
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

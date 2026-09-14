import { buildApp } from './app.js';
import { disconnectDb, prisma } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function main(): Promise<void> {
  // Fail fast at boot rather than on the first request.
  await prisma.$connect();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        workerInProcess: env.RUN_WORKER_IN_PROCESS,
      },
      'api listening',
    );
  });

  // On free-tier hosting the worker runs inside the API process, because a
  // separately deployed free worker would sleep and never claim jobs. The queue
  // lives in the database, so this changes only where the loop is started.
  if (env.RUN_WORKER_IN_PROCESS) {
    const { startWorker } = await import('./worker.js');
    await startWorker();
    logger.info('worker started in-process');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // Do not hang forever if connections refuse to drain.
    setTimeout(() => {
      logger.warn('forced shutdown after timeout');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start api');
  process.exit(1);
});

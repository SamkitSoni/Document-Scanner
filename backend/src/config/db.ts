import { PrismaClient } from '@prisma/client';
import { isProduction } from './env.js';
import { logger } from './logger.js';

/**
 * Single Prisma instance per process. In development the module may be
 * re-evaluated by the watcher, so the client is cached on globalThis to avoid
 * exhausting the connection pool across reloads.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  return new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

// Surface Prisma's own errors through the application logger rather than
// letting them print unstructured to stdout.
const emitter = prisma as unknown as {
  $on: (event: 'error' | 'warn', cb: (e: { target: string; message: string }) => void) => void;
};

emitter.$on('error', (e) => logger.error({ target: e.target }, e.message));
if (!isProduction) {
  emitter.$on('warn', (e) => logger.warn({ target: e.target }, e.message));
  globalForPrisma.prisma = prisma;
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}

import { Router } from 'express';
import { asyncHandler } from '../common/async-handler.js';
import { prisma } from '../config/db.js';
import { logger } from '../config/logger.js';

export const healthRouter: Router = Router();

/**
 * Liveness plus dependency reachability. Reports queue depth too, since "is
 * anything stuck?" is the first question when documents stop progressing.
 */
healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const startedAt = Date.now();
    let database: 'up' | 'down' = 'down';
    let queueDepth: number | null = null;

    try {
      await prisma.$queryRaw`SELECT 1`;
      database = 'up';
      queueDepth = await prisma.document.count({
        where: { status: { in: ['UPLOADED', 'RETRY_PENDING'] } },
      });
    } catch (err) {
      logger.error({ err }, 'health check: database unreachable');
    }

    const healthy = database === 'up';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        database,
        ...(queueDepth !== null ? { queueDepth } : {}),
      },
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  }),
);

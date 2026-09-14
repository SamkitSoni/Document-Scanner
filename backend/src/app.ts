import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { getCorrelationId, requestContext } from './middleware/request-context.js';
import { apiRouter } from './routes/index.js';

/**
 * Builds the Express application without binding a port.
 *
 * Keeping `listen` out of here is what lets the integration tests drive the
 * full middleware stack through Supertest without racing over ports.
 */
export function buildApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      exposedHeaders: ['x-correlation-id'],
    }),
  );

  app.use(requestContext);

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        customProps: () => ({ correlationId: getCorrelationId() }),
        // Health checks would otherwise dominate the logs.
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
  }

  // Note: no global express.json() — the upload route is multipart, and JSON
  // parsing is applied per-route where it is actually needed.
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

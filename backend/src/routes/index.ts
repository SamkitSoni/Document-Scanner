import { Router } from 'express';
import { documentsRouter } from './documents.routes.js';
import { healthRouter } from './health.routes.js';

export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use('/documents', documentsRouter);

import { Router } from 'express';
import { healthRouter } from './health.routes.js';

export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
// Mounted in phase 2:
// apiRouter.use('/documents', documentsRouter);

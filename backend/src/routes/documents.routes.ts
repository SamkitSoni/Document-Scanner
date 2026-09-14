import { Router } from 'express';
import { asyncHandler } from '../common/async-handler.js';
import * as controller from '../controllers/documents.controller.js';
import { uploadSingleDocument } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

export const documentsRouter: Router = Router();

const withId = validate({ params: controller.documentIdParamSchema });

documentsRouter.post('/', uploadSingleDocument, asyncHandler(controller.upload));

documentsRouter.get(
  '/',
  validate({ query: controller.listQuerySchema }),
  asyncHandler(controller.list),
);

// Before '/:id': Express matches in registration order, so a later literal
// route would be swallowed by the parameterised one and "stats" would be
// rejected as a malformed document id.
documentsRouter.get('/stats', asyncHandler(controller.getStats));

documentsRouter.get('/:id', withId, asyncHandler(controller.getById));
documentsRouter.get('/:id/history', withId, asyncHandler(controller.getHistory));
documentsRouter.get('/:id/file', withId, asyncHandler(controller.getFile));

documentsRouter.post('/:id/retry', withId, asyncHandler(controller.retry));

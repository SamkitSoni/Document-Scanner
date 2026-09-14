import { Router } from 'express';
import { asyncHandler } from '../common/async-handler.js';
import * as controller from '../controllers/documents.controller.js';
import { uploadSingleDocument } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

export const documentsRouter: Router = Router();

documentsRouter.post('/', uploadSingleDocument, asyncHandler(controller.upload));

documentsRouter.get(
  '/:id',
  validate({ params: controller.documentIdParamSchema }),
  asyncHandler(controller.getById),
);

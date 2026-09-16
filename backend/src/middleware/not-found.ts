import type { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../common/errors.js';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  // The method and path are internal routing detail, and echoing them back is
  // how a 404 ends up reading like a stack trace. They stay in the logs.
  next(new NotFoundError('The page you are looking for'));
}

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards rejected promises to the error handler on its own. This
 * wrapper is kept anyway: it makes the intent explicit at each call site and
 * keeps the codebase correct if a handler is ever run under Express 4 semantics.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

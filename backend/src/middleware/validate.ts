import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ValidationError } from '../common/errors.js';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Parses request parts with Zod and replaces them with the coerced result, so
 * controllers receive real numbers, dates and enum values rather than strings.
 *
 * In Express 5 `req.query` is a getter, so the parsed value is stashed on
 * `res.locals` and read through the helpers below.
 */
export function validate(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) res.locals.query = schemas.query.parse(req.query);
      next();
    } catch (err) {
      next(toValidationError(err));
    }
  };
}

function toValidationError(err: unknown): unknown {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    return new ValidationError(
      'Some details need fixing before we can continue.',
      issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }
  return err;
}

/** Typed accessor for the validated query, parsed by `validate`. */
export function validatedQuery<T>(res: Response): T {
  return res.locals.query as T;
}

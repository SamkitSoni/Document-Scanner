import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError, FileTooLargeError, ValidationError } from '../common/errors.js';
import { logger } from '../config/logger.js';
import { getCorrelationId } from './request-context.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}

/**
 * The single terminal error handler. Registered last, after all routes.
 *
 * Requirement 9 of the brief — "do not expose raw backend errors directly to
 * users" — is enforced here structurally rather than by discipline at each call
 * site: anything that is not a recognised AppError is logged in full and
 * reported to the client as a generic 500.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const correlationId = getCorrelationId();
  const normalised = normalise(err);

  const logPayload = {
    correlationId,
    code: normalised.code,
    statusCode: normalised.statusCode,
    err: normalised.logCause,
  };

  // 5xx means we broke; 4xx means the caller did. Only the former is an alert.
  if (normalised.statusCode >= 500) {
    logger.error(logPayload, 'request failed');
  } else {
    logger.warn(logPayload, 'request rejected');
  }

  const body: ErrorBody = {
    error: {
      code: normalised.code,
      message: normalised.message,
      ...(correlationId ? { correlationId } : {}),
      ...(normalised.details !== undefined ? { details: normalised.details } : {}),
    },
  };

  res.status(normalised.statusCode).json(body);
}

interface Normalised {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  logCause: unknown;
}

function normalise(err: unknown): Normalised {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      logCause: err,
    };
  }

  // Zod errors that escaped the validate() middleware.
  if (err instanceof ZodError) {
    const fieldErrors = err.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    const wrapped = new ValidationError('The request contains invalid values.', fieldErrors);
    return {
      statusCode: wrapped.statusCode,
      code: wrapped.code,
      message: wrapped.message,
      details: fieldErrors,
      logCause: err,
    };
  }

  // Multer surfaces upload problems as its own error type; without this they
  // would reach the client as opaque 500s.
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const wrapped = new FileTooLargeError('The file exceeds the maximum upload size.');
      return {
        statusCode: wrapped.statusCode,
        code: wrapped.code,
        message: wrapped.message,
        logCause: err,
      };
    }
    const wrapped = new ValidationError('The upload could not be processed.');
    return {
      statusCode: wrapped.statusCode,
      code: wrapped.code,
      message: wrapped.message,
      logCause: err,
    };
  }

  // Unknown: the real cause goes to the logs and never to the client.
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
    logCause: err,
  };
}

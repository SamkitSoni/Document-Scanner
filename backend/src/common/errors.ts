/**
 * Every error surfaced to a client goes through this hierarchy. The `code` is a
 * stable identifier the frontend can branch on; the `message` is safe to render
 * to a user. Anything that is not an AppError becomes a generic 500 with its
 * real cause confined to the logs.
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  /** Extra context for the client — never raw internals. */
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class UnsupportedFileTypeError extends AppError {
  readonly statusCode = 415;
  readonly code = 'UNSUPPORTED_FILE_TYPE';
  constructor(message = 'Only PDF files are supported.') {
    super(message);
  }
}

export class FileTooLargeError extends AppError {
  readonly statusCode = 413;
  readonly code = 'FILE_TOO_LARGE';
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(resource = 'Resource') {
    super(`${resource} was not found.`);
  }
}

/** A request that is valid but conflicts with current state (e.g. retrying a processed document). */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_ERROR';
  constructor(message = 'Something went wrong. Please try again.') {
    super(message);
  }
}

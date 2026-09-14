import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Assigns each request a correlation id, echoed in the response header and in
 * every error envelope. It is the thread a developer pulls to find the matching
 * log lines for a failure a user reported.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-correlation-id');
  const correlationId = incoming ?? `req_${randomBytes(6).toString('hex')}`;

  res.setHeader('x-correlation-id', correlationId);
  storage.run({ correlationId }, () => next());
}

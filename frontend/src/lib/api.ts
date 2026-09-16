import type {
  DocumentDetail,
  DocumentListResponse,
  HistoryEvent,
  RetryResponse,
  StatsResponse,
  UploadResponse,
} from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * An error that is safe to render.
 *
 * The backend emits `{ error: { code, message, correlationId } }` and takes
 * care that `message` is user-facing for every error it recognises, mapping
 * anything it does not to a generic 500. This class keeps that guarantee on the
 * client side: `message` is always something we are willing to put on screen,
 * and `code` is the stable identifier the UI branches on.
 *
 * Requirement 9 — "do not expose raw backend errors directly to users" — is
 * enforced here, in one place, rather than at each call site.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Shown when the server said nothing we can quote, or the network failed. */
const GENERIC_MESSAGE = 'Something went wrong on our end. Please try again in a moment.';

interface ErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorEnvelope = {};
  try {
    body = (await response.json()) as ErrorEnvelope;
  } catch {
    // A non-JSON body (a proxy error page, an empty 502) tells the user
    // nothing useful, so it is deliberately discarded in favour of the
    // generic message.
  }

  const code = body.error?.code ?? 'UNKNOWN';
  // A 5xx message is never quoted even when present: the backend's own
  // handler already replaces internal causes with a safe string, and this is
  // the second line of defence if anything else is in the path.
  const message =
    response.status >= 500 ? GENERIC_MESSAGE : (body.error?.message ?? GENERIC_MESSAGE);

  return new ApiError(code, message, response.status, body.error?.correlationId);
}

interface RequestOptions extends RequestInit {
  /** Abort signal, so a poll or a superseded filter request can be cancelled. */
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
      cache: 'no-store',
    });
  } catch (cause) {
    // An aborted request is a control-flow signal, not a failure to report.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      'NETWORK_ERROR',
      'We could not reach the server. Check your internet connection and try again.',
      0,
    );
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export interface ListParams {
  status?: string[];
  documentType?: string[];
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

/**
 * The API takes `status` and `documentType` as repeatable parameters, which
 * maps onto `URLSearchParams.append` directly — so filter state in the URL and
 * filter state on the wire are the same shape.
 */
export function buildListQuery(params: ListParams): URLSearchParams {
  const query = new URLSearchParams();

  for (const status of params.status ?? []) query.append('status', status);
  for (const type of params.documentType ?? []) query.append('documentType', type);

  if (params.search) query.set('search', params.search);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.sort) query.set('sort', params.sort);

  return query;
}

export function listDocuments(
  params: ListParams,
  signal?: AbortSignal,
): Promise<DocumentListResponse> {
  const query = buildListQuery(params).toString();
  return request<DocumentListResponse>(`/documents${query ? `?${query}` : ''}`, { signal });
}

export function getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail> {
  return request<DocumentDetail>(`/documents/${id}`, { signal });
}

export function getHistory(id: string, signal?: AbortSignal): Promise<HistoryEvent[]> {
  return request<HistoryEvent[]>(`/documents/${id}/history`, { signal });
}

export function getStats(signal?: AbortSignal): Promise<StatsResponse> {
  return request<StatsResponse>('/documents/stats', { signal });
}

export function retryDocument(id: string): Promise<RetryResponse> {
  return request<RetryResponse>(`/documents/${id}/retry`, { method: 'POST' });
}

/** The PDF preview and the download link both point at this. */
export function fileUrl(id: string): string {
  return `${BASE_URL}/documents/${id}/file`;
}

export function uploadDocument(input: {
  file: File;
  documentType: string;
  metadata?: Record<string, unknown>;
}): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('documentType', input.documentType);
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    form.append('metadata', JSON.stringify(input.metadata));
  }

  // No Content-Type header: the browser must set the multipart boundary.
  return request<UploadResponse>('/documents', { method: 'POST', body: form });
}

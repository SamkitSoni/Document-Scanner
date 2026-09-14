/**
 * The API contract, as the frontend consumes it.
 *
 * Defined here rather than imported from the backend: a workspace package for
 * one consumer was ceremony, and these are the response *shapes* the
 * controllers emit, which are deliberately narrower than the Prisma rows.
 */

export const DOCUMENT_STATUSES = [
  'UPLOADED',
  'RETRY_PENDING',
  'PROCESSING',
  'PROCESSED',
  'VALIDATION_FAILED',
  'FAILED',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Statuses from which no further automatic transition occurs. */
export const TERMINAL_STATUSES: readonly DocumentStatus[] = [
  'PROCESSED',
  'VALIDATION_FAILED',
  'FAILED',
];

export function isTerminal(status: DocumentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const DOCUMENT_TYPES = [
  'FINANCIAL_STATEMENT',
  'BANK_STATEMENT',
  'REGISTRATION_CERTIFICATE',
  'TAX_RETURN',
  'OTHER',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface ValidationIssue {
  field: string;
  rule: string;
  message: string;
}

export interface ExtractedData {
  companyName?: string;
  registrationNumber?: string;
  address?: string;
  annualRevenue?: number;
  documentDate?: string;
  [key: string]: unknown;
}

/** `GET /documents` row — a summary, not the full detail shape. */
export interface DocumentSummary {
  documentId: string;
  filename: string;
  documentType: DocumentType;
  status: DocumentStatus;
  sizeBytes: number;
  attemptCount: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /documents/:id`. */
export interface DocumentDetail extends Omit<DocumentSummary, 'failureReason'> {
  metadata: Record<string, unknown> | null;
  /** Data the system accepted. Null unless the document is PROCESSED. */
  result: ExtractedData | null;
  /** What was read but rejected. Non-null only for VALIDATION_FAILED. */
  rejectedData: ExtractedData | null;
  failureReason: string | null;
  validationErrors: ValidationIssue[] | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface DocumentListResponse {
  data: DocumentSummary[];
  pagination: Pagination;
}

export interface HistoryEvent {
  status: DocumentStatus;
  timestamp: string;
  attempt: number | null;
  reason: string | null;
  detail: unknown;
}

export interface StatsResponse {
  total: number;
  inProgress: number;
  byStatus: Record<DocumentStatus, number>;
}

export interface UploadResponse {
  documentId: string;
  status: DocumentStatus;
  duplicate?: boolean;
}

export interface RetryResponse {
  documentId: string;
  status: DocumentStatus;
  attemptCount: number;
}

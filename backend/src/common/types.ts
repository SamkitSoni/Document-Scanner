import type { DocumentStatus, DocumentType } from '@prisma/client';

export type { DocumentStatus, DocumentType };

/** Every status, in lifecycle order — the dashboard renders tiles from this. */
export const DOCUMENT_STATUSES = [
  'UPLOADED',
  'RETRY_PENDING',
  'PROCESSING',
  'PROCESSED',
  'VALIDATION_FAILED',
  'FAILED',
] as const satisfies readonly DocumentStatus[];

/** Fields the mock processor is expected to extract. */
export interface ExtractedData {
  companyName: string;
  registrationNumber: string;
  address: string;
  annualRevenue: number;
  documentDate: string;
}

export interface ValidationIssue {
  field: string;
  rule: string;
  message: string;
}

/** Stable failure codes. Surfaced to clients and logged; never free text. */
export const FailureReason = {
  PROCESSOR_TIMEOUT: 'PROCESSOR_TIMEOUT',
  PROCESSOR_ERROR: 'PROCESSOR_ERROR',
  EXTRACTED_DATA_INVALID: 'EXTRACTED_DATA_INVALID',
  ATTEMPTS_EXHAUSTED: 'ATTEMPTS_EXHAUSTED',
  LEASE_EXPIRED: 'LEASE_EXPIRED',
} as const;

export type FailureReasonCode = (typeof FailureReason)[keyof typeof FailureReason];

export interface UploadResult {
  documentId: string;
  status: DocumentStatus;
  duplicate?: boolean;
}

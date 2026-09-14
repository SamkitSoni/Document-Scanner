import type { DocumentStatus, DocumentType } from './types';

/**
 * How each status is presented — one mapping, used by the table, the dashboard
 * tiles and the timeline. Keeping it here is what stops the same status being
 * amber in one place and grey in another.
 *
 * `tone` classes are written out in full because Tailwind scans source text for
 * class names; a template-built class would be stripped from the CSS bundle.
 */
export interface StatusPresentation {
  label: string;
  /** Badge colours. */
  tone: string;
  /** Dot/marker colour, for the timeline and tiles. */
  dot: string;
  /** What this status means, in an operator's terms. */
  hint: string;
}

export const STATUS_PRESENTATION: Record<DocumentStatus, StatusPresentation> = {
  UPLOADED: {
    label: 'Uploaded',
    tone: 'bg-slate-100 text-slate-700 ring-slate-600/20 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/30',
    dot: 'bg-slate-400',
    hint: 'Waiting to be picked up by a worker.',
  },
  RETRY_PENDING: {
    label: 'Retry pending',
    tone: 'bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/30',
    dot: 'bg-amber-500',
    hint: 'A previous attempt failed; another is scheduled.',
  },
  PROCESSING: {
    label: 'Processing',
    tone: 'bg-blue-100 text-blue-800 ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/30',
    dot: 'bg-blue-500',
    hint: 'A worker is extracting data right now.',
  },
  PROCESSED: {
    label: 'Processed',
    tone: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/30',
    dot: 'bg-emerald-500',
    hint: 'Extracted and validated successfully.',
  },
  VALIDATION_FAILED: {
    label: 'Validation failed',
    tone: 'bg-orange-100 text-orange-800 ring-orange-600/20 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/30',
    dot: 'bg-orange-500',
    hint: 'The document was read, but its contents did not pass the rules.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/30',
    dot: 'bg-red-500',
    hint: 'Processing could not complete after all attempts.',
  },
};

export function statusLabel(status: DocumentStatus): string {
  return STATUS_PRESENTATION[status]?.label ?? status;
}

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  FINANCIAL_STATEMENT: 'Financial statement',
  BANK_STATEMENT: 'Bank statement',
  REGISTRATION_CERTIFICATE: 'Registration certificate',
  TAX_RETURN: 'Tax return',
  OTHER: 'Other',
};

export function documentTypeLabel(type: DocumentType | string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? String(type);
}

/**
 * Failure codes are stable identifiers, not prose. The UI is where they become
 * a sentence a user can act on; the raw code is still shown alongside so it can
 * be matched against the logs.
 */
const FAILURE_REASON_LABELS: Record<string, string> = {
  PROCESSOR_TIMEOUT: 'The processor timed out while reading this document.',
  PROCESSOR_ERROR: 'The processor hit an internal error reading this document.',
  EXTRACTED_DATA_INVALID: 'The data read from this document did not pass validation.',
  ATTEMPTS_EXHAUSTED: 'Every automatic attempt failed. A manual retry is available.',
  LEASE_EXPIRED: 'A worker stopped unexpectedly mid-attempt and the document was reclaimed.',
};

export function failureReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return FAILURE_REASON_LABELS[reason] ?? 'Processing did not complete.';
}

/** Extracted field keys are camelCase; an operator should see words. */
const FIELD_LABELS: Record<string, string> = {
  companyName: 'Company name',
  registrationNumber: 'Registration number',
  address: 'Address',
  annualRevenue: 'Annual revenue',
  documentDate: 'Document date',
};

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // Fall back to splitting camelCase, so an unmapped field is still readable.
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Values are rendered by what they are, not by their key: revenue reads as
 * currency, a date as a date, and anything else as text.
 */
export function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  if (key === 'annualRevenue' && typeof value === 'number') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  }

  if (key === 'documentDate' && typeof value === 'string') {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }
  }

  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** "2 minutes ago" — the list's upload column, where exact seconds do not help. */
export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86_400],
    ['month', 2_592_000],
    ['year', 31_536_000],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]!;
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit;
  }

  return formatter.format(-Math.round(seconds / chosen[1]), chosen[0]);
}

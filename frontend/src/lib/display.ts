import type { IconName } from '@/components/Icon';
import type { DocumentStatus, DocumentType } from './types';

/**
 * How each status is presented — one mapping, used by the table, the dashboard
 * tiles, the badges and the timeline. Keeping it here is what stops the same
 * status being amber in one place and grey in another.
 *
 * Colours are semantic tokens (`success`, `warning`, `danger`, …) rather than
 * palette names, so the theme is defined once in `globals.css` and a status's
 * colour is changed in exactly one place. Classes are written out in full
 * because Tailwind scans source text for class names; a template-built class
 * would be stripped from the CSS bundle.
 */
export interface StatusPresentation {
  label: string;
  /** Badge colours: wash background, coloured text, matching hairline ring. */
  tone: string;
  /** Solid fill, for the timeline marker and the tile accent. */
  solid: string;
  /** Text-only colour, for figures and inline emphasis. */
  text: string;
  /** The glyph carried alongside the label — shape as well as colour. */
  icon: IconName;
  /** What this status means, in an operator's terms. */
  hint: string;
}

export const STATUS_PRESENTATION: Record<DocumentStatus, StatusPresentation> = {
  UPLOADED: {
    label: 'Uploaded',
    tone: 'bg-neutral-wash text-neutral ring-neutral/20',
    solid: 'bg-neutral text-white',
    text: 'text-neutral',
    icon: 'inbox',
    hint: 'Waiting to be processed.',
  },
  RETRY_PENDING: {
    label: 'Retry pending',
    tone: 'bg-warning-wash text-warning ring-warning/25',
    solid: 'bg-warning text-white',
    text: 'text-warning',
    icon: 'retry',
    hint: 'A previous attempt did not work. We will try again shortly.',
  },
  PROCESSING: {
    label: 'Processing',
    tone: 'bg-info-wash text-info ring-info/25',
    solid: 'bg-info text-white',
    text: 'text-info',
    icon: 'spinner',
    hint: 'We are reading this document right now.',
  },
  PROCESSED: {
    label: 'Processed',
    tone: 'bg-success-wash text-success ring-success/25',
    solid: 'bg-success text-white',
    text: 'text-success',
    icon: 'check',
    hint: 'Read and checked successfully.',
  },
  VALIDATION_FAILED: {
    label: 'Validation failed',
    tone: 'bg-warning-wash text-warning ring-warning/25',
    solid: 'bg-warning text-white',
    text: 'text-warning',
    icon: 'warning',
    hint: 'We read this document, but some information did not pass our checks.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'bg-danger-wash text-danger ring-danger/25',
    solid: 'bg-danger text-white',
    text: 'text-danger',
    icon: 'alert',
    hint: 'We could not finish processing this document.',
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

/** Hours and minutes only: seconds are noise in a lifecycle read by a human. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
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

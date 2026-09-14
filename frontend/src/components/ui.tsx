import Link from 'next/link';
import type { ReactNode } from 'react';
import { STATUS_PRESENTATION } from '@/lib/display';
import type { DocumentStatus } from '@/lib/types';

/**
 * The status badge. A colour alone would not be enough — the label carries the
 * meaning, so the badge stays readable in monochrome and for colour-blind users.
 */
export function StatusBadge({
  status,
  size = 'md',
}: {
  status: DocumentStatus;
  size?: 'sm' | 'md';
}) {
  const presentation = STATUS_PRESENTATION[status];
  const animate = status === 'PROCESSING' ? 'animate-pulse' : '';

  return (
    <span
      title={presentation.hint}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset ${
        presentation.tone
      } ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${presentation.dot} ${animate}`} />
      {presentation.label}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card p-5 ${className}`}>{children}</section>;
}

export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

/** A skeleton line. Used where the final layout is known, so nothing jumps. */
export function SkeletonLine({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/**
 * Empty states always offer the next action rather than just stating a void —
 * an empty list with no way forward is a dead end.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-full bg-canvas text-2xl"
      >
        &#128196;
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action && (
        <Link href={action.href} className="btn-primary mt-2">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/**
 * An error state that renders a message we already know is safe to show —
 * `ApiError.message` is either the backend's user-facing string or the generic
 * fallback, never a raw internal cause.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
    >
      <h3 className="text-base font-semibold text-ink">Something went wrong</h3>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-2">
          Try again
        </button>
      )}
    </div>
  );
}

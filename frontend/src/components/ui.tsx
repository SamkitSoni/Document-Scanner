import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { STATUS_PRESENTATION } from '@/lib/display';
import type { DocumentStatus } from '@/lib/types';

/**
 * The status badge. Colour alone would not be enough — the label carries the
 * meaning and an icon carries the shape, so the badge stays readable in
 * monochrome and for colour-blind users.
 */
export function StatusBadge({
  status,
  size = 'md',
}: {
  status: DocumentStatus;
  size?: 'sm' | 'md';
}) {
  const presentation = STATUS_PRESENTATION[status];
  const processing = status === 'PROCESSING';

  return (
    <span
      title={presentation.hint}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium ring-1 ring-inset ${
        presentation.tone
      } ${size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'}`}
    >
      <Icon
        name={presentation.icon}
        size={size === 'sm' ? 11 : 12}
        className={processing ? 'animate-spin' : ''}
      />
      {presentation.label}
    </span>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <section className={`card ${padded ? 'p-5' : ''} ${className}`}>{children}</section>;
}

/**
 * A section heading. The optional icon gives each panel a recognisable anchor
 * when the detail page stacks five of them.
 */
export function SectionHeading({
  children,
  icon,
  action,
  className = '',
}: {
  children: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 ${className}`}>
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {icon && <Icon name={icon} size={14} />}
        {children}
      </h2>
      {action}
    </div>
  );
}

/** The page header: title, optional supporting line, optional actions. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-display text-ink">{title}</h1>
        {description && <div className="mt-1.5 text-sm text-muted">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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
  icon = 'inbox',
  action,
}: {
  title: string;
  description: string;
  icon?: IconName;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-full border border-line bg-surface-2 text-muted"
      >
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-title font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action && (
        <Link href={action.href} className="btn-primary mt-2">
          <Icon name="upload" size={15} />
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
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-full bg-danger-wash text-danger"
      >
        <Icon name="alert" size={22} />
      </div>
      <h3 className="text-title font-semibold text-ink">Something went wrong</h3>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-2">
          <Icon name="retry" size={15} />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * A callout: the one component for every inline banner (failure explanations,
 * upload outcomes, the "still processing" note). Previously each screen wrote
 * its own border/background/text triple, which is exactly how two banners drift
 * apart.
 */
export function Callout({
  tone,
  title,
  icon,
  children,
  role,
  className = '',
}: {
  tone: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  const TONES = {
    info: 'border-info/25 bg-info-wash text-info',
    success: 'border-success/25 bg-success-wash text-success',
    warning: 'border-warning/25 bg-warning-wash text-warning',
    danger: 'border-danger/25 bg-danger-wash text-danger',
  } as const;

  const DEFAULT_ICONS = {
    info: 'clock',
    success: 'check',
    warning: 'warning',
    danger: 'alert',
  } as const;

  return (
    <div
      role={role}
      className={`flex gap-3 rounded-xl border px-4 py-3.5 text-sm ${TONES[tone]} ${className}`}
    >
      <Icon name={icon ?? DEFAULT_ICONS[tone]} size={17} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {/* The body sits on ink rather than the tone colour: a full paragraph
            in a saturated hue is harder to read than the heading it follows. */}
        <div className={`${title ? 'mt-1 ' : ''}space-y-1 text-ink-2`}>{children}</div>
      </div>
    </div>
  );
}

/** A labelled value in a definition list. */
export function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`mt-1 text-sm text-ink ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</dd>
    </div>
  );
}

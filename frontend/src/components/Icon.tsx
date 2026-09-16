import type { ReactElement, SVGProps } from 'react';

/**
 * A small inline icon set.
 *
 * Inline rather than an icon package: the UI needs about a dozen glyphs, and a
 * dependency that ships a thousand — plus a tree-shaking config to avoid them —
 * is not a trade worth making here. Every path is drawn on the same 24px grid
 * with a 1.75 stroke, which is what stops the set looking assembled from
 * different sources.
 *
 * Icons are decorative by default (`aria-hidden`): every one in this UI sits
 * beside a text label that carries the meaning. Pass a `title` only where an
 * icon genuinely stands alone.
 */
export type IconName =
  | 'document'
  | 'documents'
  | 'upload'
  | 'dashboard'
  | 'check'
  | 'close'
  | 'retry'
  | 'clock'
  | 'alert'
  | 'warning'
  | 'search'
  | 'filter'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'external'
  | 'plus'
  | 'inbox'
  | 'spinner'
  | 'arrow-right'
  | 'calendar'
  | 'sort';

const PATHS: Record<IconName, ReactElement> = {
  document: (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M19 8v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5Z" />
    </>
  ),
  documents: (
    <>
      <path d="M8 3h6l4 4v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v4h4" />
      <path d="M16 18v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  retry: (
    <>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2v.3" />
    </>
  ),
  warning: (
    <>
      <path d="M10.6 4.2 3.3 17a1.6 1.6 0 0 0 1.4 2.4h14.6a1.6 1.6 0 0 0 1.4-2.4L13.4 4.2a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 16.7v.3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 2v-7.4L4 5.5Z" />,
  'chevron-left': <path d="m14.5 5.5-6 6.5 6 6.5" />,
  'chevron-right': <path d="m9.5 5.5 6 6.5-6 6.5" />,
  'chevron-down': <path d="m5.5 9.5 6.5 6 6.5-6" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-8.5 8.5" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  inbox: (
    <>
      <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4" />
      <path d="M5.4 5.2 3.5 13.5v3.9a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3.9L18.6 5.2a2 2 0 0 0-1.9-1.2H7.3a2 2 0 0 0-1.9 1.2Z" />
    </>
  ),
  spinner: (
    <>
      <circle cx="12" cy="12" r="8.5" opacity="0.25" />
      <path d="M20.5 12A8.5 8.5 0 0 0 12 3.5" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v4M16 3.5v4" />
    </>
  ),
  sort: (
    <>
      <path d="M7 4v16" />
      <path d="m3.5 16.5 3.5 3.5 3.5-3.5" />
      <path d="M13 6h8M13 11h6M13 16h4" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Pixel size; icons are square. */
  size?: number;
  /** Supply only when the icon is the sole carrier of meaning. */
  title?: string;
}

export function Icon({ name, size = 16, title, className = '', ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

/** The spinner, pre-composed so every loading affordance spins identically. */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <Icon name="spinner" size={size} className={`animate-spin ${className}`} />;
}

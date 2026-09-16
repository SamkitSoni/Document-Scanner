'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';

const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/documents', label: 'Documents', icon: 'documents' },
  { href: '/upload', label: 'Upload', icon: 'upload' },
];

/**
 * The documents tab stays active on a detail page, which is a child of the list
 * in the user's mental model even though the URL differs.
 */
function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md supports-[backdrop-filter]:bg-surface/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-lg font-semibold tracking-tight text-ink"
        >
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink shadow-sm"
          >
            <Icon name="document" size={17} />
          </span>
          <span className="hidden sm:inline">Document Pipeline</span>
        </Link>

        {/* Desktop tabs. Below `sm` these move to their own row underneath, so
            the header never wraps into a ragged two-line block. */}
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 sm:flex">
          {LINKS.map((link) => {
            const active = isActive(link.href, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <Icon name={link.icon} size={15} />
                {link.label}
                {/* An underline anchored to the header edge, rather than a
                    filled pill — it reads as a tab strip at a glance. */}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-[13px] h-0.5 rounded-full bg-accent"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <Link href="/upload" className="btn-primary btn-sm ml-auto sm:text-sm">
          <Icon name="plus" size={15} />
          Upload
        </Link>
      </div>

      {/* Mobile tab row. */}
      <nav
        aria-label="Main"
        className="flex items-center gap-1 overflow-x-auto border-t border-line px-4 py-1.5 sm:hidden"
      >
        {LINKS.map((link) => {
          const active = isActive(link.href, pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active ? 'bg-accent-wash text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon name={link.icon} size={14} />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

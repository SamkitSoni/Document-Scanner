'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/documents', label: 'Documents' },
  { href: '/upload', label: 'Upload' },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded font-semibold tracking-tight">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm text-white"
          >
            S7
          </span>
          <span>Document Pipeline</span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          {LINKS.map((link) => {
            // The documents tab stays active on a detail page, which is a child
            // of the list in the user's mental model even though the URL differs.
            const active =
              link.href === '/'
                ? pathname === '/'
                : pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-canvas hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <Link href="/upload" className="btn-primary ml-auto text-sm">
          Upload document
        </Link>
      </div>
    </header>
  );
}

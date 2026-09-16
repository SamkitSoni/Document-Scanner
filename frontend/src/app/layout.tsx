import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

/**
 * Fonts are self-hosted by `next/font` at build time — no render-blocking
 * request to Google, and no layout shift from a late swap. Inter for the UI,
 * JetBrains Mono for ids and failure codes, which are read character by
 * character and benefit from disambiguated glyphs.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'Document Pipeline',
    template: '%s · Document Pipeline',
  },
  description: 'Upload documents, track processing, and inspect extracted data.',
};

export const viewport: Viewport = {
  // Matches the `--canvas` token, so the mobile browser chrome does not sit at
  // a different shade from the page. One value, because the app is light-only.
  themeColor: '#f7f8fa',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <ToastProvider>
          {/* Keyboard users reach the content without tabbing the whole nav. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
          >
            Skip to content
          </a>
          <Nav />
          <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}

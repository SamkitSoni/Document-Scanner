import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'Document Pipeline',
  description: 'Upload documents, track processing, and inspect extracted data.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ToastProvider>
          {/* Keyboard users reach the content without tabbing the whole nav. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
          >
            Skip to content
          </a>
          <Nav />
          <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}

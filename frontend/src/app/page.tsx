'use client';

import Link from 'next/link';
import { getStats, listDocuments } from '@/lib/api';
import { documentTypeLabel, formatRelative } from '@/lib/display';
import type { DocumentListResponse, StatsResponse } from '@/lib/types';
import { isTerminal } from '@/lib/types';
import { usePolledResource } from '@/lib/usePolledResource';
import { Card, EmptyState, ErrorState, SectionHeading, SkeletonLine, StatusBadge } from '@/components/ui';

interface DashboardData {
  stats: StatsResponse;
  recent: DocumentListResponse;
}

export default function DashboardPage() {
  const { data, error, loading, refresh } = usePolledResource<DashboardData>(
    async (signal) => {
      const [stats, recent] = await Promise.all([
        getStats(signal),
        listDocuments({ pageSize: 5 }, signal),
      ]);
      return { stats, recent };
    },
    {
      // Refresh while anything is still moving; stop once everything is settled,
      // so an idle dashboard is not polling forever.
      intervalMs: (current) => (current && current.stats.inProgress > 0 ? 3000 : null),
      deps: [],
    },
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">
          Processing activity across every document in the system.
        </p>
      </div>

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={refresh} />
        </Card>
      ) : (
        <>
          <Tiles stats={data?.stats} loading={loading} />
          <RecentActivity recent={data?.recent} loading={loading} />
        </>
      )}
    </div>
  );
}

function Tiles({ stats, loading }: { stats?: StatsResponse; loading: boolean }) {
  const tiles = [
    { label: 'Total documents', value: stats?.total, hint: 'All uploads', href: '/documents' },
    {
      label: 'In progress',
      value: stats?.inProgress,
      hint: 'Queued, processing or awaiting retry',
      href: '/documents?status=UPLOADED&status=RETRY_PENDING&status=PROCESSING',
    },
    {
      label: 'Processed',
      value: stats?.byStatus.PROCESSED,
      hint: 'Extracted and validated',
      href: '/documents?status=PROCESSED',
    },
    {
      label: 'Needs attention',
      value:
        stats === undefined
          ? undefined
          : stats.byStatus.FAILED + stats.byStatus.VALIDATION_FAILED,
      hint: 'Failed or rejected by validation',
      href: '/documents?status=FAILED&status=VALIDATION_FAILED',
      emphasise: true,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className="card p-5 transition-colors hover:border-accent/50"
        >
          <p className="text-sm font-medium text-muted">{tile.label}</p>
          {loading || tile.value === undefined ? (
            <SkeletonLine className="mt-2 h-9 w-16" />
          ) : (
            <p
              className={`mt-2 text-3xl font-semibold tabular-nums ${
                tile.emphasise && tile.value > 0 ? 'text-red-600 dark:text-red-400' : 'text-ink'
              }`}
            >
              {tile.value}
            </p>
          )}
          <p className="mt-1 text-xs text-muted">{tile.hint}</p>
        </Link>
      ))}
    </div>
  );
}

function RecentActivity({
  recent,
  loading,
}: {
  recent?: DocumentListResponse;
  loading: boolean;
}) {
  return (
    <Card>
      <SectionHeading
        action={
          <Link href="/documents" className="text-sm font-medium text-accent hover:underline">
            View all
          </Link>
        }
      >
        Recent activity
      </SectionHeading>

      {loading ? (
        <ul className="space-y-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <li key={row} className="flex items-center gap-3">
              <SkeletonLine className="h-4 flex-1" />
              <SkeletonLine className="h-5 w-24" />
            </li>
          ))}
        </ul>
      ) : !recent || recent.data.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Upload a PDF to see it move through the pipeline."
          action={{ href: '/upload', label: 'Upload a document' }}
        />
      ) : (
        <ul className="divide-y divide-line">
          {recent.data.map((document) => (
            <li key={document.documentId}>
              <Link
                href={`/documents/${document.documentId}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg py-3 transition-colors hover:bg-canvas"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{document.filename}</p>
                  <p className="text-xs text-muted">
                    {documentTypeLabel(document.documentType)} &middot;{' '}
                    <span className="font-mono">{document.documentId}</span>
                  </p>
                </div>
                <span className="text-xs text-muted">{formatRelative(document.createdAt)}</span>
                <StatusBadge status={document.status} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {recent && recent.data.some((d) => !isTerminal(d.status)) && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
          Refreshing automatically while documents are processing.
        </p>
      )}
    </Card>
  );
}

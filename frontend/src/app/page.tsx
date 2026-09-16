'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionHeading,
  SkeletonLine,
  StatusBadge,
} from '@/components/ui';
import { getStats, listDocuments } from '@/lib/api';
import { documentTypeLabel, formatRelative } from '@/lib/display';
import type { DocumentListResponse, StatsResponse } from '@/lib/types';
import { isTerminal } from '@/lib/types';
import { usePolledResource } from '@/lib/usePolledResource';

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

  const live = (data?.stats.inProgress ?? 0) > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Processing activity across every document in the system."
        actions={live ? <LivePill /> : undefined}
      />

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

/** The one place the UI claims to be live, so it is stated plainly. */
function LivePill() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-info/25 bg-info-wash px-3 py-1.5 text-xs font-medium text-info">
      <span aria-hidden className="h-1.5 w-1.5 animate-breathe rounded-full bg-info" />
      Live — updating automatically
    </span>
  );
}

interface Tile {
  label: string;
  value: number | undefined;
  hint: string;
  href: string;
  icon: IconName;
  /** Token classes for the icon chip and the accent rule. */
  accent: string;
  rule: string;
  /** Needs-attention turns red only when it is actually non-zero. */
  emphasise?: boolean;
}

function Tiles({ stats, loading }: { stats?: StatsResponse; loading: boolean }) {
  const attention =
    stats === undefined ? undefined : stats.byStatus.FAILED + stats.byStatus.VALIDATION_FAILED;

  const tiles: Tile[] = [
    {
      label: 'Total documents',
      value: stats?.total,
      hint: 'All uploads',
      href: '/documents',
      icon: 'documents',
      accent: 'bg-accent-wash text-accent',
      rule: 'bg-accent',
    },
    {
      label: 'In progress',
      value: stats?.inProgress,
      hint: 'Queued, processing or awaiting retry',
      href: '/documents?status=UPLOADED&status=RETRY_PENDING&status=PROCESSING',
      icon: 'clock',
      accent: 'bg-info-wash text-info',
      rule: 'bg-info',
    },
    {
      label: 'Processed',
      value: stats?.byStatus.PROCESSED,
      hint: 'Extracted and validated',
      href: '/documents?status=PROCESSED',
      icon: 'check',
      accent: 'bg-success-wash text-success',
      rule: 'bg-success',
    },
    {
      label: 'Needs attention',
      value: attention,
      hint: 'Failed or rejected by validation',
      href: '/documents?status=FAILED&status=VALIDATION_FAILED',
      icon: 'warning',
      accent: 'bg-danger-wash text-danger',
      rule: 'bg-danger',
      emphasise: true,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile, index) => {
        const hot = tile.emphasise && (tile.value ?? 0) > 0;

        return (
          <Link
            key={tile.label}
            href={tile.href}
            style={{ animationDelay: `${index * 45}ms` }}
            className="card-interactive group relative animate-rise-in overflow-hidden p-5"
          >
            {/* A colour rule along the top edge ties the tile to its status
                family without tinting the whole card. */}
            <span aria-hidden className={`absolute inset-x-0 top-0 h-1 rounded-t-xl ${tile.rule}`} />

            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                {tile.label}
              </p>
              <span
                aria-hidden
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tile.accent}`}
              >
                <Icon name={tile.icon} size={16} />
              </span>
            </div>

            {loading || tile.value === undefined ? (
              <SkeletonLine className="mt-3 h-9 w-16" />
            ) : (
              <p
                className={`mt-3 text-4xl font-semibold tabular-nums tracking-tight ${
                  hot ? 'text-danger' : 'text-ink'
                }`}
              >
                {tile.value}
              </p>
            )}

            <p className="mt-2 flex items-center gap-1 text-xs text-muted">
              {tile.hint}
              <Icon
                name="arrow-right"
                size={13}
                className="opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
              />
            </p>
          </Link>
        );
      })}
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
    <Card padded={false}>
      <div className="px-5 pt-5">
        <SectionHeading
          icon="clock"
          action={
            <Link
              href="/documents"
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              View all
              <Icon name="arrow-right" size={13} />
            </Link>
          }
        >
          Recent activity
        </SectionHeading>
      </div>

      {loading ? (
        <ul className="divide-y divide-line">
          {[0, 1, 2, 3, 4].map((row) => (
            <li key={row} className="flex items-center gap-3 px-5 py-3.5">
              <SkeletonLine className="h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <SkeletonLine className="h-3.5 w-1/3" />
                <SkeletonLine className="h-3 w-24" />
              </div>
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
        <ul className="divide-y divide-line border-t border-line">
          {recent.data.map((document) => (
            <li key={document.documentId}>
              <Link
                href={`/documents/${document.documentId}`}
                className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-surface-2"
              >
                <span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted transition-colors group-hover:border-accent/30 group-hover:text-accent"
                >
                  <Icon name="document" size={16} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink group-hover:text-accent">
                    {document.filename}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{documentTypeLabel(document.documentType)}</span>
                    <span aria-hidden>·</span>
                    <span className="font-mono">{document.documentId}</span>
                  </p>
                </div>

                <span className="text-xs tabular-nums text-muted">
                  {formatRelative(document.createdAt)}
                </span>
                <StatusBadge status={document.status} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {recent && recent.data.some((d) => !isTerminal(d.status)) && (
        <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
          <span aria-hidden className="h-1.5 w-1.5 animate-breathe rounded-full bg-info" />
          Refreshing automatically while documents are processing.
        </p>
      )}
    </Card>
  );
}

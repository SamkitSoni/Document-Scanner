'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useMemo } from 'react';
import { Filters, type FilterValues } from '@/components/Filters';
import { Card, EmptyState, ErrorState, SkeletonLine, StatusBadge } from '@/components/ui';
import { buildListQuery, listDocuments } from '@/lib/api';
import { documentTypeLabel, formatBytes, formatRelative } from '@/lib/display';
import { isTerminal, type DocumentListResponse } from '@/lib/types';
import { usePolledResource } from '@/lib/usePolledResource';

export default function DocumentsPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={<TableSkeleton />}>
      <DocumentsView />
    </Suspense>
  );
}

function DocumentsView() {
  const router = useRouter();
  const params = useSearchParams();

  const filters: FilterValues = useMemo(
    () => ({
      status: params.getAll('status'),
      documentType: params.getAll('documentType'),
      search: params.get('search') ?? '',
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
    }),
    [params],
  );

  const page = Number(params.get('page') ?? '1');
  const sort = params.get('sort') ?? 'createdAt:desc';

  /**
   * The URL is the single source of truth for every filter. Changing one
   * rewrites the query string, which re-runs the fetch — so back/forward and a
   * shared link all behave exactly like using the controls.
   */
  const apply = useCallback(
    (next: Partial<FilterValues & { page: number; sort: string }>) => {
      const merged = { ...filters, page, sort, ...next };
      const query = buildListQuery({
        status: merged.status,
        documentType: merged.documentType,
        search: merged.search || undefined,
        from: merged.from || undefined,
        to: merged.to || undefined,
        // Any filter change returns to page 1: staying on page 4 of a result
        // set that now has two pages shows an empty table for no clear reason.
        page: 'page' in next ? merged.page : 1,
        sort: merged.sort !== 'createdAt:desc' ? merged.sort : undefined,
      });

      router.push(query.toString() ? `/documents?${query}` : '/documents', { scroll: false });
    },
    [filters, page, sort, router],
  );

  const { data, error, loading, refreshing, refresh } = usePolledResource<DocumentListResponse>(
    (signal) =>
      listDocuments(
        {
          status: filters.status,
          documentType: filters.documentType,
          search: filters.search || undefined,
          // The API takes a date range; `to` is widened to end-of-day so that
          // picking the same day for both bounds includes that day's uploads.
          from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
          to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
          page,
          sort,
        },
        signal,
      ),
    {
      intervalMs: (current) =>
        current && current.data.some((row) => !isTerminal(row.status)) ? 3000 : null,
      deps: [params.toString()],
    },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted">
            {data
              ? `${data.pagination.totalItems} document${data.pagination.totalItems === 1 ? '' : 's'}`
              : 'Loading…'}
            {refreshing && <span className="ml-2 text-xs">refreshing…</span>}
          </p>
        </div>

        <div>
          <label htmlFor="sort" className="sr-only">
            Sort by
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(event) => apply({ sort: event.target.value })}
            className="field w-auto"
          >
            <option value="createdAt:desc">Newest first</option>
            <option value="createdAt:asc">Oldest first</option>
            <option value="filename:asc">Filename A–Z</option>
            <option value="filename:desc">Filename Z–A</option>
          </select>
        </div>
      </div>

      <Filters
        values={filters}
        onChange={(next) => apply(next)}
        onReset={() => router.push('/documents', { scroll: false })}
      />

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={refresh} />
        </Card>
      ) : loading ? (
        <TableSkeleton />
      ) : !data || data.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No documents match"
            description="Try clearing a filter, or upload a document to get started."
            action={{ href: '/upload', label: 'Upload a document' }}
          />
        </Card>
      ) : (
        <>
          <DocumentTable data={data} />
          <Pagination
            pagination={data.pagination}
            onPage={(next) => apply({ page: next })}
          />
        </>
      )}
    </div>
  );
}

/**
 * A table on desktop, cards below `md`. A five-column table on a phone either
 * overflows or shrinks to unreadable, so the same data is restacked instead.
 */
function DocumentTable({ data }: { data: DocumentListResponse }) {
  return (
    <div className="card overflow-hidden">
      {/* Desktop */}
      <table className="hidden w-full text-left text-sm md:table">
        <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Document</th>
            <th scope="col" className="px-4 py-3 font-medium">Type</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">Size</th>
            <th scope="col" className="px-4 py-3 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.data.map((document) => (
            <tr key={document.documentId} className="transition-colors hover:bg-canvas">
              <td className="px-4 py-3">
                <Link
                  href={`/documents/${document.documentId}`}
                  className="font-medium text-ink hover:text-accent hover:underline"
                >
                  {document.filename}
                </Link>
                <p className="font-mono text-xs text-muted">{document.documentId}</p>
              </td>
              <td className="px-4 py-3 text-muted">{documentTypeLabel(document.documentType)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={document.status} size="sm" />
                {document.attemptCount > 1 && (
                  <p className="mt-1 text-xs text-muted">{document.attemptCount} attempts</p>
                )}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted">
                {formatBytes(document.sizeBytes)}
              </td>
              <td className="px-4 py-3 text-muted">
                <time dateTime={document.createdAt}>{formatRelative(document.createdAt)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile */}
      <ul className="divide-y divide-line md:hidden">
        {data.data.map((document) => (
          <li key={document.documentId}>
            <Link
              href={`/documents/${document.documentId}`}
              className="block space-y-2 px-4 py-3 transition-colors hover:bg-canvas"
            >
              <div className="flex items-start justify-between gap-3">
                {/* Uploaded filenames are long and often unbroken, which has no
                    wrap opportunity — `break-all` is what keeps one from
                    pushing the badge off the card. */}
                <span className="min-w-0 flex-1 break-all font-medium text-ink">
                  {document.filename}
                </span>
                <span className="shrink-0">
                  <StatusBadge status={document.status} size="sm" />
                </span>
              </div>
              <p className="font-mono text-xs text-muted">{document.documentId}</p>
              <p className="text-xs text-muted">
                {documentTypeLabel(document.documentType)} &middot;{' '}
                {formatBytes(document.sizeBytes)} &middot; {formatRelative(document.createdAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pagination({
  pagination,
  onPage,
}: {
  pagination: DocumentListResponse['pagination'];
  onPage: (page: number) => void;
}) {
  const { page, pageSize, totalItems, totalPages } = pagination;
  if (totalPages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-muted">
        Showing <span className="font-medium text-ink">{first}</span>–
        <span className="font-medium text-ink">{last}</span> of{' '}
        <span className="font-medium text-ink">{totalItems}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="btn-secondary"
        >
          Previous
        </button>
        <span className="text-muted">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="btn-secondary"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function TableSkeleton() {
  return (
    <div className="card divide-y divide-line">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-4">
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-4 w-1/3" />
            <SkeletonLine className="h-3 w-24" />
          </div>
          <SkeletonLine className="h-5 w-24" />
          <SkeletonLine className="hidden h-4 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}

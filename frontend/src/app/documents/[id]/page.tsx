'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Timeline } from '@/components/Timeline';
import { useToast } from '@/components/Toast';
import { Card, ErrorState, SectionHeading, SkeletonLine, StatusBadge } from '@/components/ui';
import { ApiError, fileUrl, getDocument, getHistory, retryDocument } from '@/lib/api';
import {
  documentTypeLabel,
  failureReasonLabel,
  fieldLabel,
  formatBytes,
  formatDateTime,
  formatFieldValue,
} from '@/lib/display';
import { isTerminal, type DocumentDetail, type HistoryEvent } from '@/lib/types';
import { usePolledResource } from '@/lib/usePolledResource';

interface DetailData {
  document: DocumentDetail;
  history: HistoryEvent[];
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { notify } = useToast();

  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const { data, error, loading, refresh } = usePolledResource<DetailData>(
    async (signal) => {
      const [document, history] = await Promise.all([
        getDocument(id, signal),
        getHistory(id, signal),
      ]);
      return { document, history };
    },
    {
      // Poll only while this document can still change on its own.
      intervalMs: (current) => (current && !isTerminal(current.document.status) ? 2000 : null),
      deps: [id],
    },
  );

  async function onRetry() {
    setRetrying(true);
    try {
      await retryDocument(id);
      notify('Retry queued. The document will be processed again shortly.', 'success');
      setConfirmingRetry(false);
      refresh();
    } catch (cause) {
      notify(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
        'error',
      );
    } finally {
      setRetrying(false);
    }
  }

  if (loading) return <DetailSkeleton />;

  if (error || !data) {
    return (
      <Card>
        <ErrorState message={error ?? 'Document not found.'} onRetry={refresh} />
        <div className="text-center">
          <Link href="/documents" className="text-sm font-medium text-accent hover:underline">
            Back to documents
          </Link>
        </div>
      </Card>
    );
  }

  const { document, history } = data;
  const extracted = document.result ?? document.rejectedData;
  const rejected = document.result === null && document.rejectedData !== null;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/documents" className="text-muted hover:text-accent hover:underline">
          Documents
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="font-mono text-ink">{document.documentId}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Wrapped, not truncated: the filename identifies the page, so
              hiding its end is worse than letting it take a second line. */}
          <h1 className="break-all text-2xl font-semibold tracking-tight">{document.filename}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <StatusBadge status={document.status} />
            <span>{documentTypeLabel(document.documentType)}</span>
            <span>{formatBytes(document.sizeBytes)}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <a href={fileUrl(document.documentId)} target="_blank" rel="noreferrer" className="btn-secondary">
            Open PDF
          </a>
          {document.status === 'FAILED' && (
            <button type="button" onClick={() => setConfirmingRetry(true)} className="btn-primary">
              Retry processing
            </button>
          )}
        </div>
      </header>

      {!isTerminal(document.status) && (
        <div
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-blue-600/20 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-400/30 dark:bg-blue-950 dark:text-blue-100"
        >
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          This document is still being processed. The page updates automatically.
        </div>
      )}

      <FailureNotice document={document} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <SectionHeading>Document information</SectionHeading>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Document ID" value={document.documentId} mono />
              <Field label="Type" value={documentTypeLabel(document.documentType)} />
              <Field label="Uploaded" value={formatDateTime(document.createdAt)} />
              <Field label="Last updated" value={formatDateTime(document.updatedAt)} />
              <Field label="Size" value={formatBytes(document.sizeBytes)} />
              <Field label="Processing attempts" value={String(document.attemptCount)} />
            </dl>

            {document.metadata && Object.keys(document.metadata).length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  Metadata
                </h3>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {Object.entries(document.metadata).map(([key, value]) => (
                    <Field key={key} label={key} value={String(value)} />
                  ))}
                </dl>
              </div>
            )}
          </Card>

          {document.validationErrors && document.validationErrors.length > 0 && (
            <Card className="border-orange-600/30">
              <SectionHeading>Validation errors</SectionHeading>
              <ul className="space-y-2">
                {document.validationErrors.map((issue, index) => (
                  <li
                    key={`${issue.field}-${index}`}
                    className="rounded-lg border border-orange-600/20 bg-orange-50 px-3 py-2 text-sm dark:border-orange-400/30 dark:bg-orange-950/40"
                  >
                    <p className="font-medium text-ink">{fieldLabel(issue.field)}</p>
                    <p className="text-muted">{issue.message}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted/80">rule: {issue.rule}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <SectionHeading>
              {rejected ? 'Data read from the document (rejected)' : 'Extracted information'}
            </SectionHeading>

            {extracted && Object.keys(extracted).length > 0 ? (
              <>
                {rejected && (
                  <p className="mb-4 text-sm text-muted">
                    This is what the processor read. It was rejected by the rules above and has
                    not been passed downstream.
                  </p>
                )}
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {Object.entries(extracted).map(([key, value]) => {
                    const failed = document.validationErrors?.some((e) => e.field === key);
                    return (
                      <div key={key}>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                          {fieldLabel(key)}
                        </dt>
                        <dd
                          className={`mt-1 text-sm ${
                            failed ? 'font-medium text-orange-700 dark:text-orange-300' : 'text-ink'
                          }`}
                        >
                          {/* An empty string is exactly what failed a
                              "required" rule, so it is named rather than
                              rendered as a bare dash the reader must interpret. */}
                          {failed && (value === '' || value === null || value === undefined)
                            ? 'Not present in the document'
                            : formatFieldValue(key, value)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </>
            ) : (
              <p className="text-sm text-muted">
                {isTerminal(document.status)
                  ? 'No data was extracted from this document.'
                  : 'Nothing extracted yet — processing is still in progress.'}
              </p>
            )}
          </Card>

          <Card>
            <SectionHeading>Document preview</SectionHeading>
            {/* An <object> degrades to its fallback where inline PDF viewing is
                unavailable, rather than showing an empty frame. */}
            <object
              data={fileUrl(document.documentId)}
              type="application/pdf"
              className="h-[36rem] w-full rounded-lg border border-line"
              aria-label={`Preview of ${document.filename}`}
            >
              <div className="p-6 text-center text-sm text-muted">
                <p>Your browser cannot display PDFs inline.</p>
                <a
                  href={fileUrl(document.documentId)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block font-medium text-accent hover:underline"
                >
                  Open the PDF in a new tab
                </a>
              </div>
            </object>
          </Card>
        </div>

        <div className="lg:col-span-1">
          {/* Bounded and scrollable: a document that has been retried several
              times produces a timeline taller than the viewport, and a sticky
              element taller than the screen cannot be scrolled to its end. */}
          <Card className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <SectionHeading>Processing history</SectionHeading>
            <Timeline events={history} />
          </Card>
        </div>
      </div>

      {confirmingRetry && (
        <ConfirmRetryDialog
          documentId={document.documentId}
          attemptCount={document.attemptCount}
          busy={retrying}
          onConfirm={onRetry}
          onCancel={() => setConfirmingRetry(false)}
        />
      )}
    </div>
  );
}

/**
 * The failure explanation. A stable code alone ("PROCESSOR_TIMEOUT") is not an
 * explanation for a user, so it is rendered as a sentence — with the code kept
 * visible so it can still be matched against the logs.
 */
function FailureNotice({ document }: { document: DocumentDetail }) {
  if (document.status !== 'FAILED' && document.status !== 'VALIDATION_FAILED') return null;

  const explanation = failureReasonLabel(document.failureReason);
  const validation = document.status === 'VALIDATION_FAILED';

  return (
    <div
      role="alert"
      className={`rounded-lg border px-4 py-3 text-sm ${
        validation
          ? 'border-orange-600/20 bg-orange-50 text-orange-900 dark:border-orange-400/30 dark:bg-orange-950 dark:text-orange-100'
          : 'border-red-600/20 bg-red-50 text-red-900 dark:border-red-400/30 dark:bg-red-950 dark:text-red-100'
      }`}
    >
      <p className="font-medium">
        {validation ? 'Validation failed' : 'Processing failed'}
      </p>
      {explanation && <p className="mt-1">{explanation}</p>}
      <p className="mt-1">
        {validation
          ? 'Retrying would produce the same result, because the document was read correctly and its contents are what failed. This needs a corrected document.'
          : `Attempted ${document.attemptCount} time${document.attemptCount === 1 ? '' : 's'}. You can retry processing manually.`}
      </p>
      {document.failureReason && (
        <p className="mt-1 font-mono text-xs opacity-80">{document.failureReason}</p>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function ConfirmRetryDialog({
  documentId,
  attemptCount,
  busy,
  onConfirm,
  onCancel,
}: {
  documentId: string;
  attemptCount: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onCancel}
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="retry-title"
        className="card w-full max-w-md space-y-4 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="retry-title" className="text-lg font-semibold">
          Retry processing?
        </h2>
        <p className="text-sm text-muted">
          <span className="font-mono">{documentId}</span> already failed {attemptCount} time
          {attemptCount === 1 ? '' : 's'}. Retrying resets its attempt budget and queues it for
          processing again.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn-primary" disabled={busy}>
            {busy ? 'Queueing…' : 'Retry processing'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonLine className="h-4 w-48" />
      <SkeletonLine className="h-8 w-80" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card space-y-4 p-5">
            <SkeletonLine className="h-4 w-40" />
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((row) => (
                <SkeletonLine key={row} className="h-10" />
              ))}
            </div>
          </div>
          <div className="card p-5">
            <SkeletonLine className="h-72" />
          </div>
        </div>
        <div className="card space-y-4 p-5">
          <SkeletonLine className="h-4 w-32" />
          {[0, 1, 2].map((row) => (
            <SkeletonLine key={row} className="h-10" />
          ))}
        </div>
      </div>
    </div>
  );
}

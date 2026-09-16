'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, Spinner } from '@/components/Icon';
import { Timeline } from '@/components/Timeline';
import { useToast } from '@/components/Toast';
import {
  Callout,
  Card,
  ErrorState,
  Field,
  SectionHeading,
  SkeletonLine,
  StatusBadge,
} from '@/components/ui';
import { ApiError, fileUrl, getDocument, getHistory, retryDocument } from '@/lib/api';
import {
  documentTypeLabel,
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
      notify('We are processing this document again.', 'success');
      setConfirmingRetry(false);
      refresh();
    } catch (cause) {
      notify(
        cause instanceof ApiError
          ? cause.message
          : 'Something went wrong on our end. Please try again in a moment.',
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
        <ErrorState message={error ?? 'We could not find that document.'} onRetry={refresh} />
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
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <Link
          href="/documents"
          className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-accent"
        >
          <Icon name="chevron-left" size={14} />
          Documents
        </Link>
        <span aria-hidden className="text-line-strong">
          /
        </span>
        <span className="font-mono text-[13px] text-ink-2">{document.documentId}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <span
            aria-hidden
            className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-muted sm:grid"
          >
            <Icon name="document" size={22} />
          </span>
          <div className="min-w-0">
            {/* Wrapped, not truncated: the filename identifies the page, so
                hiding its end is worse than letting it take a second line. */}
            <h1 className="break-all text-display text-ink">{document.filename}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
              <StatusBadge status={document.status} />
              <span>{documentTypeLabel(document.documentType)}</span>
              <span aria-hidden className="text-line-strong">
                ·
              </span>
              <span className="tabular-nums">{formatBytes(document.sizeBytes)}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <a
            href={fileUrl(document.documentId)}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            <Icon name="external" size={15} />
            Open PDF
          </a>
          {document.status === 'FAILED' && (
            <button type="button" onClick={() => setConfirmingRetry(true)} className="btn-primary">
              <Icon name="retry" size={15} />
              Retry processing
            </button>
          )}
        </div>
      </header>

      {!isTerminal(document.status) && (
        <Callout tone="info" icon="clock">
          <p className="flex items-center gap-2" aria-live="polite">
            <span aria-hidden className="h-1.5 w-1.5 animate-breathe rounded-full bg-info" />
            This document is still being processed. The page updates automatically.
          </p>
        </Callout>
      )}

      <FailureNotice document={document} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <SectionHeading icon="document">Document information</SectionHeading>
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <Field label="Document ID" value={document.documentId} mono />
              <Field label="Type" value={documentTypeLabel(document.documentType)} />
              <Field label="Uploaded" value={formatDateTime(document.createdAt)} />
              <Field label="Last updated" value={formatDateTime(document.updatedAt)} />
              <Field label="Size" value={formatBytes(document.sizeBytes)} />
              <Field label="Processing attempts" value={String(document.attemptCount)} />
            </dl>

            {document.metadata && Object.keys(document.metadata).length > 0 && (
              <div className="mt-5 border-t border-line pt-5">
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Metadata
                </h3>
                <dl className="flex flex-wrap gap-2">
                  {Object.entries(document.metadata).map(([key, value]) => (
                    <div
                      key={key}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs"
                    >
                      <dt className="font-medium text-muted">{key}</dt>
                      <dd className="font-mono text-ink">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Card>

          {document.validationErrors && document.validationErrors.length > 0 && (
            <Card className="border-warning/30">
              <SectionHeading icon="warning">
                Validation errors
                <span className="ml-1 rounded-full bg-warning-wash px-1.5 py-0.5 text-[10px] font-bold text-warning">
                  {document.validationErrors.length}
                </span>
              </SectionHeading>
              <ul className="space-y-2">
                {document.validationErrors.map((issue, index) => (
                  <li
                    key={`${issue.field}-${index}`}
                    className="flex gap-2.5 rounded-lg border border-warning/20 bg-warning-wash px-3 py-2.5 text-sm"
                  >
                    <Icon name="warning" size={15} className="mt-0.5 text-warning" />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{fieldLabel(issue.field)}</p>
                      <p className="mt-0.5 text-ink-2">{issue.message}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted">rule: {issue.rule}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <SectionHeading icon={rejected ? 'warning' : 'check'}>
              {rejected ? 'Data read from the document (rejected)' : 'Extracted information'}
            </SectionHeading>

            {extracted && Object.keys(extracted).length > 0 ? (
              <>
                {rejected && (
                  <p className="mb-4 text-sm text-muted">
                    This is what the processor read. It was rejected by the rules above and has not
                    been passed downstream.
                  </p>
                )}
                <dl className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(extracted).map(([key, value]) => {
                    const failed = document.validationErrors?.some((e) => e.field === key);
                    return (
                      <div
                        key={key}
                        className={`rounded-lg border px-3 py-2.5 ${
                          failed
                            ? 'border-warning/30 bg-warning-wash'
                            : 'border-line bg-surface-2'
                        }`}
                      >
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          {fieldLabel(key)}
                        </dt>
                        <dd
                          className={`mt-1 break-words text-sm ${
                            failed ? 'font-medium text-warning' : 'text-ink'
                          }`}
                        >
                          {/* An empty string is exactly what failed a
                              "required" rule, so it is named rather than
                              rendered as a bare dash the reader must interpret. */}
                          {failed && (value === '' || value === null || value === undefined)
                            ? 'Not found in the document'
                            : formatFieldValue(key, value)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                {isTerminal(document.status)
                  ? 'We could not read any information from this document.'
                  : 'We are still reading this document. Information will appear here shortly.'}
              </p>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-5 py-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <Icon name="document" size={14} />
                Document preview
              </h2>
              <a
                href={fileUrl(document.documentId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
              >
                Open in a new tab
                <Icon name="external" size={13} />
              </a>
            </div>
            {/* An <object> degrades to its fallback where inline PDF viewing is
                unavailable, rather than showing an empty frame. */}
            <object
              data={fileUrl(document.documentId)}
              type="application/pdf"
              className="h-[36rem] w-full bg-surface-2"
              aria-label={`Preview of ${document.filename}`}
            >
              <div className="p-8 text-center text-sm text-muted">
                <p>Your browser cannot display PDFs inline.</p>
                <a
                  href={fileUrl(document.documentId)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary mt-3"
                >
                  <Icon name="external" size={15} />
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
          <Card className="scroll-subtle lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <SectionHeading icon="clock">Processing history</SectionHeading>
            <Timeline events={history} live={!isTerminal(document.status)} />
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
 * The failure notice. Internal codes are not an explanation for a user, so the
 * notice says what happened in plain words; the code stays visible, labelled as
 * a support reference, so it can still be matched against the logs.
 */
function FailureNotice({ document }: { document: DocumentDetail }) {
  if (document.status !== 'FAILED' && document.status !== 'VALIDATION_FAILED') return null;

  const validation = document.status === 'VALIDATION_FAILED';

  return (
    <Callout
      role="alert"
      tone={validation ? 'warning' : 'danger'}
      title={validation ? 'This document needs attention' : 'Something went wrong'}
    >
      <p>
        {validation
          ? 'We read this document successfully, but some of the information in it did not pass our checks. Trying again would give the same result — please upload a corrected document.'
          : 'You can try again, or upload the document another time.'}
      </p>
    </Callout>
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
  // Escape closes the dialog from anywhere, not just when the overlay happens
  // to hold focus — a keydown handler on a div only fires for focused children.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="retry-title"
        className="card w-full max-w-md animate-slide-in p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex gap-3.5">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-wash text-accent"
          >
            <Icon name="retry" size={19} />
          </span>
          <div className="min-w-0">
            <h2 id="retry-title" className="text-title font-semibold text-ink">
              Retry processing?
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              <span className="font-mono text-[13px] text-ink-2">{documentId}</span> already failed{' '}
              {attemptCount} time{attemptCount === 1 ? '' : 's'}. Retrying resets its attempt budget
              and starts processing it again.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn-primary" disabled={busy}>
            {busy ? <Spinner size={15} /> : <Icon name="retry" size={15} />}
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
      <div className="flex gap-4">
        <SkeletonLine className="hidden h-12 w-12 rounded-xl sm:block" />
        <div className="flex-1 space-y-2">
          <SkeletonLine className="h-8 w-80" />
          <SkeletonLine className="h-5 w-56" />
        </div>
      </div>
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

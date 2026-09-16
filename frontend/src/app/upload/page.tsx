'use client';

import Link from 'next/link';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Icon, Spinner } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Callout, Card, PageHeader, SectionHeading } from '@/components/ui';
import { ApiError, uploadDocument } from '@/lib/api';
import { documentTypeLabel, formatBytes } from '@/lib/display';
import { DOCUMENT_TYPES, type UploadResponse } from '@/lib/types';

/** Mirrors the backend's cap, so an oversized file is caught before the request. */
const MAX_BYTES = 10 * 1024 * 1024;

type Outcome =
  | { kind: 'created'; response: UploadResponse; filename: string }
  | { kind: 'duplicate'; response: UploadResponse; filename: string };

interface MetadataRow {
  key: string;
  value: string;
}

export default function UploadPage() {
  const { notify } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>(DOCUMENT_TYPES[0]);
  const [metadata, setMetadata] = useState<MetadataRow[]>([{ key: '', value: '' }]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectFile(candidate: File | undefined) {
    setOutcome(null);
    if (!candidate) return;

    // Checked client-side purely so the user hears about it instantly; the
    // backend enforces both rules regardless, by magic bytes rather than name.
    if (!candidate.name.toLowerCase().endsWith('.pdf') && candidate.type !== 'application/pdf') {
      setError('That file is not a PDF. Please choose a PDF document.');
      setFile(null);
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError(`That file is ${formatBytes(candidate.size)}. The limit is 10 MB.`);
      setFile(null);
      return;
    }

    setError(null);
    setFile(candidate);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || submitting) return;

    setSubmitting(true);
    setError(null);
    setOutcome(null);

    const collected = Object.fromEntries(
      metadata
        .filter((row) => row.key.trim() !== '')
        .map((row) => [row.key.trim(), row.value] as const),
    );

    try {
      const response = await uploadDocument({ file, documentType, metadata: collected });

      // A duplicate is a 200 with the original document, not an error — the
      // user is told plainly and pointed at the document that already exists.
      const kind = response.duplicate ? 'duplicate' : 'created';
      setOutcome({ kind, response, filename: file.name });
      notify(
        kind === 'duplicate'
          ? 'This document has already been uploaded.'
          : 'Your document was uploaded and is being processed.',
        kind === 'duplicate' ? 'info' : 'success',
      );

      setFile(null);
      setMetadata([{ key: '', value: '' }]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? cause.message
          : 'Something went wrong on our end. Please try again in a moment.';
      setError(message);
      notify(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Upload a document"
        description="PDF files only, up to 10 MB. We start processing your document as soon as it is uploaded."
      />

      {outcome && <OutcomeBanner outcome={outcome} />}

      {error && (
        <Callout tone="danger" role="alert" title="We could not upload your document">
          <p>{error}</p>
        </Callout>
      )}

      <Card>
        <form onSubmit={onSubmit} className="space-y-6">
          <div>
            <span className="label">Document file</span>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200 ${
                dragging
                  ? 'scale-[1.01] border-accent bg-accent-wash'
                  : file
                    ? 'border-success/40 bg-success-wash'
                    : 'border-line bg-surface-2 hover:border-accent/40'
              }`}
            >
              {file ? (
                <div className="flex flex-col items-center gap-3">
                  <span
                    aria-hidden
                    className="grid h-12 w-12 place-items-center rounded-xl bg-success text-white shadow-sm"
                  >
                    <Icon name="check" size={22} />
                  </span>
                  <div>
                    <p className="break-all text-sm font-semibold text-ink">{file.name}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      {formatBytes(file.size)} · ready to upload
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (inputRef.current) inputRef.current.value = '';
                    }}
                    className="btn-ghost btn-sm"
                  >
                    <Icon name="close" size={13} />
                    Choose a different file
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <span
                    aria-hidden
                    className={`grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface text-muted transition-colors ${
                      dragging ? 'border-accent text-accent' : ''
                    }`}
                  >
                    <Icon name="upload" size={22} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {dragging ? 'Drop to attach' : 'Drag a PDF here'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">or pick one from your computer</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="btn-secondary btn-sm"
                  >
                    Browse files
                  </button>
                </div>
              )}

              {/* The real control stays in the DOM and labelled, so keyboard and
                  screen-reader users get the native file picker. */}
              <input
                ref={inputRef}
                id="file"
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
            </div>
          </div>

          <div>
            <label htmlFor="documentType" className="label">
              Document type
            </label>
            <select
              id="documentType"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
              className="field"
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {documentTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="border-t border-line pt-5">
            <legend className="sr-only">Metadata</legend>
            <SectionHeading icon="documents" className="mb-2">
              Metadata (optional)
            </SectionHeading>
            <p className="mb-3 text-xs text-muted">
              Free-form key/value pairs stored alongside the document, for example a broker id.
            </p>
            <div className="space-y-2">
              {metadata.map((row, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    aria-label={`Metadata key ${index + 1}`}
                    placeholder="key"
                    value={row.key}
                    onChange={(event) =>
                      setMetadata((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)),
                      )
                    }
                    className="field flex-1"
                  />
                  <input
                    aria-label={`Metadata value ${index + 1}`}
                    placeholder="value"
                    value={row.value}
                    onChange={(event) =>
                      setMetadata((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)),
                      )
                    }
                    className="field flex-1"
                  />
                  <button
                    type="button"
                    aria-label={`Remove metadata row ${index + 1}`}
                    onClick={() =>
                      setMetadata((rows) =>
                        rows.length === 1
                          ? [{ key: '', value: '' }]
                          : rows.filter((_, i) => i !== index),
                      )
                    }
                    className="btn-secondary px-2.5 text-muted hover:text-danger"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMetadata((rows) => [...rows, { key: '', value: '' }])}
              className="btn-ghost btn-sm mt-2 text-accent"
            >
              <Icon name="plus" size={14} />
              Add another field
            </button>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <button type="submit" disabled={!file || submitting} className="btn-primary">
              {submitting ? <Spinner size={15} /> : <Icon name="upload" size={15} />}
              {submitting ? 'Uploading…' : 'Upload document'}
            </button>
            <p className="text-xs text-muted">You can keep working while we process it.</p>
          </div>
        </form>
      </Card>
    </div>
  );
}

/**
 * Success and duplicate are visually distinct: a duplicate is not a failure,
 * but telling a user "uploaded" when nothing new was created would be a lie.
 */
function OutcomeBanner({ outcome }: { outcome: Outcome }) {
  const duplicate = outcome.kind === 'duplicate';

  return (
    <Callout
      role="status"
      tone={duplicate ? 'warning' : 'success'}
      icon={duplicate ? 'documents' : 'check'}
      title={duplicate ? 'Already uploaded' : 'Document uploaded'}
      className="animate-rise-in"
    >
      <p>
        {duplicate
          ? 'This is the same file as a document you have already uploaded, so we kept the original instead of adding a copy.'
          : `${outcome.filename} was uploaded and is now being processed.`}
      </p>
      <Link
        href={`/documents/${outcome.response.documentId}`}
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
      >
        View {outcome.response.documentId}
        <Icon name="arrow-right" size={14} />
      </Link>
    </Callout>
  );
}

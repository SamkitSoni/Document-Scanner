'use client';

import Link from 'next/link';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useToast } from '@/components/Toast';
import { Card } from '@/components/ui';
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
      setError('Only PDF files are supported.');
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
      const response = await uploadDocument({
        file,
        documentType,
        metadata: collected,
      });

      // A duplicate is a 200 with the original document, not an error — the
      // user is told plainly and pointed at the document that already exists.
      const kind = response.duplicate ? 'duplicate' : 'created';
      setOutcome({ kind, response, filename: file.name });
      notify(
        kind === 'duplicate'
          ? 'This document was already uploaded.'
          : 'Upload accepted. Processing has started.',
        kind === 'duplicate' ? 'info' : 'success',
      );

      setFile(null);
      setMetadata([{ key: '', value: '' }]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.';
      setError(message);
      notify(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload a document</h1>
        <p className="mt-1 text-sm text-muted">
          PDF only, up to 10 MB. Processing starts automatically once the upload is accepted.
        </p>
      </div>

      {outcome && <OutcomeBanner outcome={outcome} />}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-600/20 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-400/30 dark:bg-red-950 dark:text-red-100"
        >
          {error}
        </div>
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
              className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                dragging ? 'border-accent bg-accent/5' : 'border-line'
              }`}
            >
              {file ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink">{file.name}</p>
                  <p className="text-xs text-muted">{formatBytes(file.size)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (inputRef.current) inputRef.current.value = '';
                    }}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Choose a different file
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted">Drag a PDF here, or</p>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="btn-secondary"
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

          <fieldset>
            <legend className="label">Metadata (optional)</legend>
            <p className="mb-2 text-xs text-muted">
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
                    className="btn-secondary px-3"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMetadata((rows) => [...rows, { key: '', value: '' }])}
              className="mt-2 text-sm font-medium text-accent hover:underline"
            >
              Add another field
            </button>
          </fieldset>

          <div className="flex items-center gap-3 border-t border-line pt-4">
            <button type="submit" disabled={!file || submitting} className="btn-primary">
              {submitting && (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              )}
              {submitting ? 'Uploading…' : 'Upload document'}
            </button>
            <p className="text-xs text-muted">The upload returns immediately.</p>
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
    <div
      role="status"
      className={`rounded-lg border px-4 py-3 text-sm ${
        duplicate
          ? 'border-amber-600/20 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950 dark:text-amber-100'
          : 'border-emerald-600/20 bg-emerald-50 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950 dark:text-emerald-100'
      }`}
    >
      <p className="font-medium">
        {duplicate ? 'Already uploaded' : 'Upload accepted'}
      </p>
      <p className="mt-1">
        {duplicate
          ? 'This file is byte-for-byte identical to a document already in the system, so it was not uploaded again.'
          : `${outcome.filename} was accepted and queued for processing.`}
      </p>
      <Link
        href={`/documents/${outcome.response.documentId}`}
        className="mt-2 inline-block font-medium underline underline-offset-2"
      >
        View {outcome.response.documentId}
      </Link>
    </div>
  );
}

import type { Document, DocumentType, Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import {
  ConflictError,
  NotFoundError,
  UnsupportedFileTypeError,
  ValidationError,
} from '../common/errors.js';
import { DOCUMENT_STATUSES, type DocumentStatus, type UploadResult } from '../common/types.js';
import { logger } from '../config/logger.js';
import * as documentsRepo from '../repositories/documents.repo.js';
import * as eventsRepo from '../repositories/events.repo.js';
import { computeContentHash, fileStorage, storageKeyFor } from '../storage/file-storage.js';

// Excludes look-alike characters so ids stay readable when spoken or retyped.
const nanoid = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 10);

export function generateDocumentId(): string {
  return `DOC-${nanoid()}`;
}

/** PDFs begin with %PDF-. The declared content type is client-controlled. */
function isPdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString('latin1') === '%PDF-';
}

export interface UploadInput {
  file?: Express.Multer.File;
  documentType: DocumentType;
  metadata?: Record<string, unknown>;
}

export async function uploadDocument(input: UploadInput): Promise<UploadResult> {
  const { file, documentType, metadata } = input;

  if (!file) {
    throw new ValidationError('Choose a PDF file to upload.');
  }
  if (!isPdf(file.buffer)) {
    throw new UnsupportedFileTypeError(
      'That file is not a PDF. Please upload a PDF document.',
    );
  }

  const contentHash = computeContentHash(file.buffer);

  // Fast path: a byte-identical document already exists. Re-uploading is
  // idempotent rather than an error — the caller gets the original document.
  const existing = await documentsRepo.findByContentHash(contentHash);
  if (existing) {
    logger.info(
      { documentId: existing.id, contentHash, filename: file.originalname },
      'duplicate upload ignored',
    );
    return { documentId: existing.id, status: existing.status, duplicate: true };
  }

  const documentId = generateDocumentId();
  const storageKey = storageKeyFor(documentId);
  await fileStorage.save(storageKey, file.buffer);

  try {
    const document = await documentsRepo.createWithEvent({
      id: documentId,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      documentType,
      contentHash,
      storageKey,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
    });

    logger.info(
      {
        documentId: document.id,
        documentType,
        sizeBytes: file.size,
        contentHash,
      },
      'document uploaded',
    );

    return { documentId: document.id, status: document.status };
  } catch (err) {
    // The unique constraint on content_hash is the authority: two concurrent
    // uploads of the same bytes race here, and the loser resolves to the
    // winner's document rather than failing.
    if (isUniqueViolation(err, 'content_hash')) {
      const winner = await documentsRepo.findByContentHash(contentHash);
      if (winner) {
        await fileStorage.delete(storageKey);
        logger.info({ documentId: winner.id, contentHash }, 'duplicate upload resolved by race');
        return { documentId: winner.id, status: winner.status, duplicate: true };
      }
    }

    // Do not leave an orphaned file behind if the row could not be written.
    await fileStorage.delete(storageKey);
    throw err;
  }
}

function isUniqueViolation(err: unknown, field: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.some((t) => String(t).includes(field));
  return typeof target === 'string' ? target.includes(field) : true;
}

export async function getDocument(id: string): Promise<Document | null> {
  return documentsRepo.findById(id);
}

export interface ListDocumentsOptions extends documentsRepo.ListFilters {
  page: number;
  pageSize: number;
  sortField: 'createdAt' | 'filename';
  sortDirection: 'asc' | 'desc';
}

export async function listDocuments(options: ListDocumentsOptions) {
  const { items, totalItems } = await documentsRepo.list(options);

  return {
    items,
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      // A page size is always at least 1, so this cannot divide by zero.
      totalPages: Math.ceil(totalItems / options.pageSize),
    },
  };
}

export async function getHistory(documentId: string) {
  // Distinguish "no such document" from "a document with no events yet", which
  // would otherwise both return an empty array.
  const document = await documentsRepo.findById(documentId);
  if (!document) throw new NotFoundError('That document');

  return eventsRepo.listForDocument(documentId);
}

/**
 * Dashboard counts. Statuses absent from the grouped query are filled in as
 * zero, so the UI can render a stable set of tiles rather than branching on
 * which keys happen to exist.
 */
export async function getStats() {
  const counts = await documentsRepo.countByStatus();

  const byStatus = Object.fromEntries(
    DOCUMENT_STATUSES.map((status) => [status, counts[status] ?? 0]),
  ) as Record<DocumentStatus, number>;

  return {
    total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
    byStatus,
    // The dashboard's headline figure: work neither finished nor abandoned.
    inProgress: byStatus.UPLOADED + byStatus.RETRY_PENDING + byStatus.PROCESSING,
  };
}

/** The stored file, for the PDF preview. */
export async function getDocumentFile(
  documentId: string,
): Promise<{ document: Document; data: Buffer }> {
  const document = await documentsRepo.findById(documentId);
  if (!document) throw new NotFoundError('That document');

  const data = await fileStorage.read(document.storageKey);
  return { document, data };
}

/**
 * Manual retry.
 *
 * Only a terminally `FAILED` document is eligible. `VALIDATION_FAILED` is
 * excluded on purpose: the processor already succeeded and the content is bad,
 * so a retry would deterministically reproduce the same rejection. A document
 * still moving through the pipeline is excluded because the worker owns it.
 */
export async function retryDocument(documentId: string): Promise<Document> {
  const document = await documentsRepo.findById(documentId);
  if (!document) throw new NotFoundError('That document');

  if (document.status !== 'FAILED') {
    // Never interpolate the raw status: 'RETRY_PENDING' is an internal constant,
    // not a phrase. Each case gets the sentence that is true for it — telling
    // someone to "wait for it to finish" when it already succeeded is worse
    // than saying nothing.
    const explanation =
      document.status === 'VALIDATION_FAILED'
        ? 'This document was read successfully, but the information in it did not pass our checks. Retrying will not change that — please upload a corrected document.'
        : document.status === 'PROCESSED'
          ? 'This document has already been processed successfully, so there is nothing to retry.'
          : 'This document is still being processed. You can try again if it does not finish successfully.';

    throw new ConflictError(explanation);
  }

  const retried = await documentsRepo.resetForManualRetry(documentId);
  logger.info(
    { documentId, previousAttempts: document.attemptCount },
    'manual retry requested',
  );

  return retried;
}

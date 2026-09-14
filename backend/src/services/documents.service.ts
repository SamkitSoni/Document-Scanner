import type { Document, DocumentType, Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { UnsupportedFileTypeError, ValidationError } from '../common/errors.js';
import type { UploadResult } from '../common/types.js';
import { logger } from '../config/logger.js';
import * as documentsRepo from '../repositories/documents.repo.js';
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
    throw new ValidationError('A file is required.');
  }
  if (!isPdf(file.buffer)) {
    throw new UnsupportedFileTypeError(
      'The uploaded file is not a valid PDF. Only PDF documents are supported.',
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

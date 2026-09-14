import { Prisma } from '@prisma/client';
import type { Document, DocumentStatus, DocumentType } from '@prisma/client';
import { prisma } from '../config/db.js';

export interface CreateDocumentInput {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  documentType: DocumentType;
  contentHash: string;
  storageKey: string;
  metadata: Prisma.InputJsonValue;
}

export interface ListFilters {
  status?: DocumentStatus[];
  documentType?: DocumentType[];
  search?: string;
  from?: Date;
  to?: Date;
}

export interface ListOptions extends ListFilters {
  page: number;
  pageSize: number;
  sortField: 'createdAt' | 'filename';
  sortDirection: 'asc' | 'desc';
}

/**
 * Creates a document and its first event in a single transaction, so a document
 * can never exist without the history entry explaining how it got there.
 */
export async function createWithEvent(input: CreateDocumentInput): Promise<Document> {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        ...input,
        status: 'UPLOADED',
        // Claimable immediately; the worker picks it up on its next poll.
        nextAttemptAt: new Date(),
      },
    });

    await tx.documentEvent.create({
      data: { documentId: document.id, status: 'UPLOADED' },
    });

    return document;
  });
}

export async function findById(id: string): Promise<Document | null> {
  return prisma.document.findUnique({ where: { id } });
}

export async function findByContentHash(contentHash: string): Promise<Document | null> {
  return prisma.document.findUnique({ where: { contentHash } });
}

function buildWhere(filters: ListFilters): Prisma.DocumentWhereInput {
  const where: Prisma.DocumentWhereInput = {};

  if (filters.status?.length) where.status = { in: filters.status };
  if (filters.documentType?.length) where.documentType = { in: filters.documentType };
  if (filters.search) where.filename = { contains: filters.search, mode: 'insensitive' };

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  return where;
}

export async function list(
  options: ListOptions,
): Promise<{ items: Document[]; totalItems: number }> {
  const where = buildWhere(options);

  const [items, totalItems] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { [options.sortField]: options.sortDirection },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
    prisma.document.count({ where }),
  ]);

  return { items, totalItems };
}

export async function countByStatus(): Promise<Record<string, number>> {
  const rows = await prisma.document.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

/**
 * Every transition below writes the document row and its history event in one
 * transaction. That invariant is what keeps `GET /documents/:id` and
 * `GET /documents/:id/history` from ever disagreeing about what happened.
 */
export interface TransitionInput {
  documentId: string;
  status: DocumentStatus;
  attempt: number;
  reason?: string | null;
  detail?: Prisma.InputJsonValue;
  extractedData?: Prisma.InputJsonValue | null;
  validationErrors?: Prisma.InputJsonValue | null;
  /** When set, the document becomes claimable again at this time. */
  nextAttemptAt?: Date | null;
  /** Cleared on every terminal transition so no lease is left dangling. */
  clearLock?: boolean;
}

export async function applyTransition(input: TransitionInput): Promise<Document> {
  const {
    documentId,
    status,
    attempt,
    reason,
    detail,
    extractedData,
    validationErrors,
    nextAttemptAt,
    clearLock = true,
  } = input;

  return prisma.$transaction(async (tx) => {
    const document = await tx.document.update({
      where: { id: documentId },
      data: {
        status,
        ...(reason !== undefined ? { failureReason: reason } : {}),
        ...(extractedData !== undefined
          ? { extractedData: extractedData === null ? Prisma.DbNull : extractedData }
          : {}),
        ...(validationErrors !== undefined
          ? { validationErrors: validationErrors === null ? Prisma.DbNull : validationErrors }
          : {}),
        ...(nextAttemptAt !== undefined ? { nextAttemptAt } : {}),
        ...(clearLock ? { lockedAt: null } : {}),
      },
    });

    await tx.documentEvent.create({
      data: {
        documentId,
        status,
        attempt,
        ...(reason ? { reason } : {}),
        ...(detail !== undefined ? { detail } : {}),
      },
    });

    return document;
  });
}

/** Records the PROCESSING event for a document the queue has already claimed. */
export async function recordClaimEvent(documentId: string, attempt: number): Promise<void> {
  await prisma.documentEvent.create({
    data: { documentId, status: 'PROCESSING', attempt },
  });
}

/**
 * Manual retry: clears the previous failure and makes a terminally FAILED
 * document due again. The attempt counter is reset because an operator retrying
 * by hand is asserting that the underlying problem is fixed — a fresh budget,
 * not the remainder of the old one.
 */
export async function resetForManualRetry(documentId: string): Promise<Document> {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.update({
      where: { id: documentId },
      data: {
        status: 'RETRY_PENDING',
        attemptCount: 0,
        failureReason: null,
        validationErrors: Prisma.DbNull,
        nextAttemptAt: new Date(),
        lockedAt: null,
      },
    });

    await tx.documentEvent.create({
      data: {
        documentId,
        status: 'RETRY_PENDING',
        attempt: 0,
        reason: 'MANUAL_RETRY',
      },
    });

    return document;
  });
}

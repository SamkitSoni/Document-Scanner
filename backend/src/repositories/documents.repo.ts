import type { Document, DocumentStatus, DocumentType, Prisma } from '@prisma/client';
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
  fileData?: Uint8Array;
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
    const { fileData, ...rest } = input;

    const document = await tx.document.create({
      data: {
        ...rest,
        // Prisma's Bytes maps to Uint8Array; a Buffer is one, but the generic
        // parameter differs, so it is normalised here at the boundary.
        ...(fileData ? { fileData: new Uint8Array(fileData) } : {}),
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

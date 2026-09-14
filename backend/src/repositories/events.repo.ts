import type { DocumentEvent } from '@prisma/client';
import { prisma } from '../config/db.js';

export async function listForDocument(documentId: string): Promise<DocumentEvent[]> {
  return prisma.documentEvent.findMany({
    where: { documentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

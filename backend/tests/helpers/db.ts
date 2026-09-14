import { prisma } from '../../src/config/db.js';

/** Events cascade from documents, so removing documents clears both tables. */
export async function resetDatabase(): Promise<void> {
  await prisma.document.deleteMany();
}

export { prisma };

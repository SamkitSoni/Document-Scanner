import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { NotFoundError } from '../common/errors.js';

/**
 * Storage is behind an interface because the deployed environment cannot use
 * the filesystem: Render's disk is ephemeral, so uploaded bytes would vanish on
 * redeploy. Swapping to S3 or R2 later means adding a third implementation, not
 * changing any caller.
 */
export interface FileStorage {
  save(key: string, data: Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class DiskStorage implements FileStorage {
  constructor(private readonly basePath: string) {}

  private resolveKey(key: string): string {
    const base = resolve(this.basePath);
    const target = resolve(join(base, key));
    // Defence in depth: keys are generated internally, but a path that escapes
    // the storage root must never be readable or writable.
    if (target !== base && !target.startsWith(base + '/')) {
      throw new Error('Resolved storage path escapes the storage root');
    }
    return target;
  }

  async save(key: string, data: Buffer): Promise<string> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      throw new NotFoundError('Stored file');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch {
      // Already gone: deleting is idempotent.
    }
  }
}

/**
 * Stores bytes in the documents row itself. Used where the filesystem is not
 * durable. Acceptable at this scale given the 10MB upload cap; object storage
 * is the right answer for real volume.
 */
class PostgresStorage implements FileStorage {
  async save(key: string): Promise<string> {
    // The bytes are written by the upload transaction alongside the row, so
    // that document creation and its file land atomically.
    return key;
  }

  async read(key: string): Promise<Buffer> {
    const row = await prisma.document.findUnique({
      where: { id: key },
      select: { fileData: true },
    });
    if (!row?.fileData) throw new NotFoundError('Stored file');
    return Buffer.from(row.fileData);
  }

  async delete(): Promise<void> {
    // Cascades with the document row.
  }
}

export const fileStorage: FileStorage =
  env.STORAGE_DRIVER === 'postgres' ? new PostgresStorage() : new DiskStorage(env.STORAGE_PATH);

export const usesInlineStorage = env.STORAGE_DRIVER === 'postgres';

/** SHA-256 of the file bytes — the basis for duplicate detection. */
export function computeContentHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Storage key derived from the document id, keeping the two trivially linked. */
export function storageKeyFor(documentId: string): string {
  return `${documentId}.pdf`;
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { NotFoundError } from '../common/errors.js';

/**
 * Storage sits behind an interface because uploaded bytes outlive this
 * project's local disk: a deployed container's filesystem is ephemeral, so the
 * production answer is object storage. Adding S3 or R2 means a second
 * implementation here and no change to any caller.
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
      throw new NotFoundError('The stored document');
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

export const fileStorage: FileStorage = new DiskStorage(env.STORAGE_PATH);

/** SHA-256 of the file bytes — the basis for duplicate detection. */
export function computeContentHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Storage key derived from the document id, keeping the two trivially linked. */
export function storageKeyFor(documentId: string): string {
  return `${documentId}.pdf`;
}

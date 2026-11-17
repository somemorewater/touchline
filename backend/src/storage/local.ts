import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { StorageAdapter } from './index.js';

const SAFE_KEY = /^[a-z0-9]+\/[a-f0-9-]{36}$/;

/**
 * Filesystem adapter rooted at a configured directory.
 *
 * Storage keys are generated server-side and must match `SAFE_KEY`; callers
 * cannot supply paths, separators, traversal segments or extensions. The
 * resolved path is re-checked against the root before every operation.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = 'local';
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) {
      throw new Error('Invalid storage key.');
    }
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) {
      throw new Error('Storage key escapes the storage root.');
    }
    return target;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data, { flag: 'wx', mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

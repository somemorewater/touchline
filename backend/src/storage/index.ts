import { env } from '../config/env.js';
import { LocalStorageAdapter } from './local.js';

export interface StorageAdapter {
  readonly provider: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

let adapter: StorageAdapter | null = null;

/**
 * Configurable binary storage. Only the local adapter ships in this phase.
 * The interface is intentionally small so a future S3-compatible adapter can
 * be added without changing evidence metadata or routes.
 */
export function storage(): StorageAdapter {
  if (!adapter) {
    adapter = new LocalStorageAdapter(env.FILE_STORAGE_DIR);
  }
  return adapter;
}

export type { LocalStorageAdapter };

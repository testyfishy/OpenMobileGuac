import { Directory, Filesystem, Encoding } from '@capacitor/filesystem';
import type { KeyValueStore } from './KeyValueStore.ts';

/**
 * A `KeyValueStore` of small files in the app's cache directory (native only), for data
 * that may be thrown away and must not be backed up: session thumbnails, which are
 * pictures of remote screens (AUDIT #12).
 *
 * - iOS: `Library/Caches`, excluded from iCloud and device backups; the OS may purge it.
 * - Android: `getCacheDir()`, excluded from auto-backup; cleared with "Clear cache".
 *
 * One file per key, named by the URI-encoded key, in `dir/`.
 */
export class CacheFileKeyValueStore implements KeyValueStore {
  private readonly dir: string;

  constructor(dir = 'thumbnails') {
    this.dir = dir;
  }

  private path(key: string): string {
    return `${this.dir}/${encodeURIComponent(key)}`;
  }

  async get(key: string): Promise<string | null> {
    try {
      const r = await Filesystem.readFile({
        path: this.path(key),
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      return typeof r.data === 'string' ? r.data : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await Filesystem.writeFile({
      path: this.path(key),
      directory: Directory.Cache,
      data: value,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async remove(key: string): Promise<void> {
    await Filesystem.deleteFile({ path: this.path(key), directory: Directory.Cache }).catch(
      () => undefined,
    );
  }

  async keys(prefix = ''): Promise<string[]> {
    try {
      const r = await Filesystem.readdir({ path: this.dir, directory: Directory.Cache });
      return r.files
        .map((f) => {
          try {
            return decodeURIComponent(f.name);
          } catch {
            return '';
          }
        })
        .filter((k) => k !== '' && k.startsWith(prefix));
    } catch {
      return [];
    }
  }
}

/**
 * Minimal async key-value interface for **non-secret** app data (profiles, favourites,
 * recents, settings). It is async so that a native preferences plugin can implement it later.
 * Secrets go in `SecureStore` instead.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** All keys that start with `prefix`. */
  keys(prefix?: string): Promise<string[]>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(prefix = ''): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** The subset of the DOM `Storage` interface we use. Injected so tests need no DOM. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `KeyValueStore` over a Web `Storage` (`localStorage`), with every key namespaced by
 * `namespace`. Suitable for non-secret data only.
 */
export class WebStorageKeyValueStore implements KeyValueStore {
  private readonly storage: StorageLike;
  private readonly namespace: string;

  constructor(storage: StorageLike, namespace = 'omg:') {
    this.storage = storage;
    this.namespace = namespace;
  }

  async get(key: string): Promise<string | null> {
    return this.storage.getItem(this.namespace + key);
  }

  async set(key: string, value: string): Promise<void> {
    this.storage.setItem(this.namespace + key, value);
  }

  async remove(key: string): Promise<void> {
    this.storage.removeItem(this.namespace + key);
  }

  async keys(prefix = ''): Promise<string[]> {
    const full = this.namespace + prefix;
    const out: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k !== null && k.startsWith(full)) out.push(k.slice(this.namespace.length));
    }
    return out;
  }
}

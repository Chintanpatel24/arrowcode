/**
 * High-speed in-memory caches for ArrowCode.
 * Lightning path: avoid re-reading personalities, templates, file stats, and greps.
 */

export class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    // refresh recency
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** TTL cache — good for directory listings / tool results */
export class TTLCache<K, V> {
  private map = new Map<K, { v: V; exp: number }>();
  constructor(
    private capacity: number,
    private ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (this.map.size >= this.capacity && !this.map.has(key)) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
    this.map.set(key, { v: value, exp: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  invalidate(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** Global shared caches (process lifetime) */
export const perfCaches = {
  /** personality markdown by agent id */
  personality: new LRUCache<string, string>(32),
  /** template by id */
  template: new LRUCache<string, unknown>(64),
  /** file content by abs path + mtime key */
  fileContent: new LRUCache<string, string>(256),
  /** list_dir results */
  listDir: new TTLCache<string, string>(128, 3_000),
  /** glob results */
  glob: new TTLCache<string, string>(64, 5_000),
  /** system prompt fragments */
  systemPrompt: new LRUCache<string, string>(64),
  /** ARROW.md content */
  projectBrain: new TTLCache<string, string>(16, 10_000),
};

export function invalidateFileCaches(pathHint?: string): void {
  if (!pathHint) {
    perfCaches.fileContent.clear();
    perfCaches.listDir.clear();
    perfCaches.glob.clear();
    return;
  }
  // coarse invalidation
  perfCaches.listDir.clear();
  perfCaches.glob.clear();
  // file content keys include path
  // LRU doesn't support prefix delete cheaply — clear content cache on writes
  perfCaches.fileContent.clear();
  perfCaches.projectBrain.clear();
  perfCaches.systemPrompt.clear();
}

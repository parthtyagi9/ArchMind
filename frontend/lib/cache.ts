// In-memory request cache for immutable-per-index data (file tree, file contents, graph). Keys embed the
// repo's indexed_at, so a reindex naturally produces fresh entries.
const MAX_ENTRIES = 300;
const store = new Map<string, Promise<unknown>>();

export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit) return hit as Promise<T>;
  const p = load();
  store.set(key, p);
  p.catch(() => { if (store.get(key) === p) store.delete(key); });
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  return p;
}

export function invalidate(prefix: string): void {
  for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k);
}

import { getLatestMtime } from "./paths";

const cache = new Map<string, { mtime: number; value: unknown }>();
const MAX_CACHE = 256;

export function withMtimeCache<T>(filePath: string, compute: () => T): T {
  const mtime = getLatestMtime(filePath);
  const hit = cache.get(filePath);
  if (hit && hit.mtime === mtime) {
    return hit.value as T;
  }

  const value = compute();
  cache.set(filePath, { mtime, value });
  if (cache.size > MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  return value;
}

export function invalidateParseCache(filePath?: string): void {
  if (filePath) {
    cache.delete(filePath);
    return;
  }
  cache.clear();
}

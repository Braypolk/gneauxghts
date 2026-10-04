/** Document-owned bytes only. DOM, selections and gestures belong to each view. */
export function createImageAssetLoader(read: (name: string) => Promise<string>, root: () => string | null,
  fingerprint?: (name: string) => Promise<string>,
  limits = { entries: 128, bytes: 24 * 1024 * 1024 }) {
  const cache = new Map<string, { url: string; fingerprint: string }>();
  const pending = new Map<string, Promise<string>>();
  let generation = 0, bytes = 0;
  return {
    async load(name: string, refresh = false) {
      const key = `${root() ?? ''}\0${name}`;
      if (refresh && cache.has(key)) { bytes -= cache.get(key)!.url.length; cache.delete(key); }
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const epoch = generation;
      const request = (async () => {
        const stamp = fingerprint ? await fingerprint(name) : '';
        const hit = cache.get(key);
        if (hit && hit.fingerprint === stamp) { cache.delete(key); cache.set(key, hit); return hit.url; }
        const url = await read(name);
        if (generation === epoch) {
          if (hit) bytes -= hit.url.length;
          cache.set(key, { url, fingerprint: stamp }); bytes += url.length;
          while (cache.size > limits.entries || bytes > limits.bytes) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            bytes -= cache.get(oldest)!.url.length; cache.delete(oldest);
          }
        }
        return url;
      })().finally(() => { if (pending.get(key) === request) pending.delete(key); });
      pending.set(key, request);
      return request;
    },
    destroy() { generation++; cache.clear(); pending.clear(); bytes = 0; }
  };
}

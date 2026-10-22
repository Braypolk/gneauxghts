export interface ImageDimensions { width: number; height: number }

/** Intrinsic size hints only; each pane still owns its image and layout. */
export function createImageDimensionCache(root: () => string | null, limit = 128) {
  const entries = new Map<string, ImageDimensions & { url: string }>();
  const key = (name: string) => `${root() ?? ''}\0${name}`;
  return {
    get(name: string, url?: string): ImageDimensions | undefined {
      const id = key(name), entry = entries.get(id);
      if (!entry) return;
      if (url !== undefined && entry.url !== url) { entries.delete(id); return; }
      entries.delete(id); entries.set(id, entry);
      return { width: entry.width, height: entry.height };
    },
    set(name: string, url: string, dimensions: ImageDimensions) {
      if (![dimensions.width, dimensions.height].every(value => Number.isFinite(value) && value > 0)) return;
      const id = key(name);
      entries.delete(id); entries.set(id, { ...dimensions, url });
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
    clear() { entries.clear(); }
  };
}
export type ImageDimensionCache = ReturnType<typeof createImageDimensionCache>;

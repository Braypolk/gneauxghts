/**
 * Phase 5: helpers for the draft-ref IPC protocol used by search, related
 * notes, and wikilink commands. The frontend computes a small fingerprint
 * of the current unsaved markdown and records which `(path, hash)` pairs
 * the backend has already cached. Subsequent requests can skip the full
 * body and only send the hash. On a cache miss the backend returns an
 * error prefixed with `draft-cache-miss:` and the caller retries with the
 * body inlined.
 */

const DRAFT_CACHE_MISS_PREFIX = 'draft-cache-miss';

/** FNV-1a 32-bit hash, hex-encoded. Fast enough to run on every keystroke. */
export function computeDraftHash(body: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const acknowledgedDrafts = new Map<string, string>();

function fingerprintKey(path: string | null) {
  return path ?? '<unsaved>';
}

export function isDraftAcknowledged(path: string | null, hash: string): boolean {
  return acknowledgedDrafts.get(fingerprintKey(path)) === hash;
}

export function rememberDraft(path: string | null, hash: string): void {
  acknowledgedDrafts.set(fingerprintKey(path), hash);
}

export function forgetDraft(path: string | null): void {
  acknowledgedDrafts.delete(fingerprintKey(path));
}

export function isDraftCacheMiss(error: unknown): boolean {
  if (typeof error === 'string') {
    return error.startsWith(DRAFT_CACHE_MISS_PREFIX);
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === 'string' && message.startsWith(DRAFT_CACHE_MISS_PREFIX);
  }
  return false;
}

/**
 * Run a draft-aware IPC call. The first attempt sends only the hash if the
 * backend has previously acknowledged this `(path, hash)` pair; otherwise
 * the body is inlined. A `draft-cache-miss` failure triggers exactly one
 * retry with the body inlined.
 */
export async function callWithDraft<T>(
  path: string | null,
  hash: string,
  body: string,
  invokeOnce: (currentMarkdown: string | null, currentBodyHash: string) => Promise<T>
): Promise<T> {
  const sendBody = !isDraftAcknowledged(path, hash);
  try {
    const result = await invokeOnce(sendBody ? body : null, hash);
    rememberDraft(path, hash);
    return result;
  } catch (error) {
    if (!sendBody && isDraftCacheMiss(error)) {
      forgetDraft(path);
      const result = await invokeOnce(body, hash);
      rememberDraft(path, hash);
      return result;
    }
    throw error;
  }
}

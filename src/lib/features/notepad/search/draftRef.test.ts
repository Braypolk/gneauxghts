import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callWithDraft,
  computeDraftHash,
  forgetDraft,
  isDraftAcknowledged,
  isDraftCacheMiss,
  rememberDraft
} from './draftRef';

describe('draftRef helpers', () => {
  beforeEach(() => {
    forgetDraft('/vault/current.md');
    forgetDraft(null);
  });

  it('computeDraftHash is stable for identical input', () => {
    const left = computeDraftHash('hello world');
    const right = computeDraftHash('hello world');
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{8}$/);
  });

  it('computeDraftHash changes when content changes', () => {
    expect(computeDraftHash('a')).not.toBe(computeDraftHash('b'));
  });

  it('detects draft cache miss errors', () => {
    expect(isDraftCacheMiss('draft-cache-miss:/vault/note.md')).toBe(true);
    expect(isDraftCacheMiss(new Error('draft-cache-miss:/vault/note.md'))).toBe(true);
    expect(isDraftCacheMiss('something else')).toBe(false);
  });

  it('callWithDraft inlines body on the first call and remembers the hash', async () => {
    const invocation = vi.fn().mockResolvedValue('ok');
    const hash = computeDraftHash('body');
    await callWithDraft('/vault/current.md', hash, 'body', invocation);
    expect(invocation).toHaveBeenCalledWith('body', hash);
    expect(isDraftAcknowledged('/vault/current.md', hash)).toBe(true);
  });

  it('callWithDraft omits body on subsequent calls with the same hash', async () => {
    const hash = computeDraftHash('body');
    rememberDraft('/vault/current.md', hash);
    const invocation = vi.fn().mockResolvedValue('ok');
    await callWithDraft('/vault/current.md', hash, 'body', invocation);
    expect(invocation).toHaveBeenCalledWith(null, hash);
  });

  it('callWithDraft retries with body on a cache miss error', async () => {
    const hash = computeDraftHash('body');
    rememberDraft('/vault/current.md', hash);
    const invocation = vi
      .fn()
      .mockRejectedValueOnce('draft-cache-miss:/vault/current.md')
      .mockResolvedValueOnce('ok');
    const result = await callWithDraft('/vault/current.md', hash, 'body', invocation);
    expect(result).toBe('ok');
    expect(invocation).toHaveBeenNthCalledWith(1, null, hash);
    expect(invocation).toHaveBeenNthCalledWith(2, 'body', hash);
  });

  it('callWithDraft propagates non-cache-miss errors without retrying', async () => {
    const hash = computeDraftHash('body');
    rememberDraft('/vault/current.md', hash);
    const invocation = vi.fn().mockRejectedValueOnce('boom');
    await expect(
      callWithDraft('/vault/current.md', hash, 'body', invocation)
    ).rejects.toBe('boom');
    expect(invocation).toHaveBeenCalledTimes(1);
  });
});

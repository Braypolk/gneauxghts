import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callWithDraft, computeDraftHash, forgetDraft } from './draftRef';

const path = '/vault/current.md';
const body = 'body';
const hash = computeDraftHash(body);

beforeEach(() => forgetDraft(path));

describe('draft-ref protocol', () => {
  it('produces a stable fingerprint that changes with the content', () => {
    expect(computeDraftHash(body)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(computeDraftHash('changed')).not.toBe(hash);
  });

  it('sends the body once and then references the acknowledged hash', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    await callWithDraft(path, hash, body, invoke);
    await callWithDraft(path, hash, body, invoke);
    expect(invoke.mock.calls).toEqual([[body, hash], [null, hash]]);
  });

  it.each(['draft-cache-miss:current', new Error('draft-cache-miss:current')])(
    'retries an acknowledged draft with its body on %s', async (error) => {
      const invoke = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(error).mockResolvedValueOnce('recovered');
      await callWithDraft(path, hash, body, invoke);
      expect(await callWithDraft(path, hash, body, invoke)).toBe('recovered');
      expect(invoke.mock.calls).toEqual([[body, hash], [null, hash], [body, hash]]);
    }
  );

  it('propagates non-cache errors without retrying', async () => {
    const invoke = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce('boom');
    await callWithDraft(path, hash, body, invoke);
    await expect(callWithDraft(path, hash, body, invoke)).rejects.toBe('boom');
    expect(invoke.mock.calls).toEqual([[body, hash], [null, hash]]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { DocumentRuntime } from './documentRuntime';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('DocumentRuntime persistence', () => {
  it('keeps one running operation and only the latest pending operation', async () => {
    const runtime = new DocumentRuntime('document:runtime');
    const firstWrite = deferred();
    const operations: string[] = [];

    const drain = runtime.requestSave(async () => {
      operations.push('first');
      await firstWrite.promise;
    });
    await vi.waitFor(() => expect(operations).toEqual(['first']));

    const firstJoin = runtime.requestSave(async () => {
      operations.push('superseded');
    });
    const secondJoin = runtime.requestSave(async () => {
      operations.push('latest');
    });

    expect(firstJoin).toBe(drain);
    expect(secondJoin).toBe(drain);

    firstWrite.resolve();
    await drain;

    expect(operations).toEqual(['first', 'latest']);
  });

  it('retains its immutable open-document handle for its whole lifetime', () => {
    const runtime = new DocumentRuntime('document:runtime');

    expect(runtime.documentHandle).toBe('document:runtime');
  });

  it('reports a failed drain and remains usable for a later save', async () => {
    const runtime = new DocumentRuntime('document:runtime');
    const failure = new Error('disk unavailable');

    await expect(
      runtime.requestSave(async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    const retry = vi.fn(async () => undefined);
    await expect(runtime.requestSave(retry)).resolves.toBeUndefined();
    expect(retry).toHaveBeenCalledOnce();
  });
});

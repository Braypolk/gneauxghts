import { describe, expect, it, vi } from 'vitest';
import { DocumentRegistry } from './documentRegistry';
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
    const runtime = new DocumentRuntime('draft:runtime');
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

  it('preserves the exact runtime object when a draft receives its path key', () => {
    const registry = new DocumentRegistry();
    const runtime = registry.ensure('draft:runtime');

    registry.transfer('draft:runtime', 'path:/vault/Runtime.md');

    expect(registry.get('draft:runtime')).toBeNull();
    expect(registry.get('path:/vault/Runtime.md')).toBe(runtime);
    expect(runtime.noteKey).toBe('path:/vault/Runtime.md');
  });
});

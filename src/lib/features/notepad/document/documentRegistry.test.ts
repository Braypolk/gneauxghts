import { describe, expect, it } from 'vitest';
import { DocumentRegistry } from './documentRegistry';
import type { DocumentHandle } from '$lib/features/notepad/state/noteStore';

describe('DocumentRegistry stable handles', () => {
  it('returns one runtime for one immutable open-document handle', () => {
    const registry = new DocumentRegistry();
    const handle = 'document:registry-test' as DocumentHandle;

    const first = registry.ensure(handle);
    const second = registry.ensure(handle);

    expect(second).toBe(first);
    expect(first.documentHandle).toBe(handle);
    expect([...registry.values()]).toEqual([first]);
  });

  it('keeps independently opened document resources separate', () => {
    const registry = new DocumentRegistry();
    const left = registry.ensure('document:left');
    const right = registry.ensure('document:right');

    expect(left).not.toBe(right);
    expect(left.documentHandle).toBe('document:left');
    expect(right.documentHandle).toBe('document:right');
  });
});

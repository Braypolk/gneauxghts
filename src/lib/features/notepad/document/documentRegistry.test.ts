import { describe, expect, it, vi } from 'vitest';
import { DocumentRegistry } from './documentRegistry';
import type { NoteKey } from '$lib/features/notepad/state/noteStore';

describe('DocumentRegistry transfer', () => {
  it('preserves the canonical editor runtime when a draft receives a path key', () => {
    const registry = new DocumentRegistry();
    const draftKey = 'draft:transfer-test' as NoteKey;
    const pathKey = 'path:/vault/Transfer.md' as NoteKey;
    const resources = registry.ensure(draftKey).ensureResources({
      assetRootPath: null,
      storePastedImage: async () => ({
        fileName: 'unused',
        filePath: 'unused'
      })
    });
    resources.runtime.replaceMarkdown('history-bearing draft');

    registry.transfer(draftKey, pathKey);

    expect(registry.get(draftKey)).toBeNull();
    expect(registry.get(pathKey)?.resources()?.runtime).toBe(
      resources.runtime
    );
    expect(resources.runtime.markdown).toBe('history-bearing draft');
  });

  it('keeps target resources and disposes detached source resources after a collision rebind', () => {
    const registry = new DocumentRegistry();
    const draftKey = 'draft:collision-test' as NoteKey;
    const pathKey = 'path:/vault/Existing.md' as NoteKey;
    const resourceOptions = {
      assetRootPath: null,
      storePastedImage: async () => ({
        fileName: 'unused',
        filePath: 'unused'
      })
    };
    const source = registry
      .ensure(draftKey)
      .ensureResources(resourceOptions);
    const target = registry
      .ensure(pathKey)
      .ensureResources(resourceOptions);
    const destroySource = vi.spyOn(source, 'destroy');

    registry.transfer(draftKey, pathKey);

    expect(registry.get(pathKey)?.resources()).toBe(target);
    expect(destroySource).toHaveBeenCalledOnce();
    expect(registry.get(draftKey)).toBeNull();
  });
});

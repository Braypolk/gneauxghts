import { describe, expect, it, vi } from 'vitest';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createWorkspacePersistenceService } from './workspacePersistenceService';

describe('workspacePersistenceService', () => {
  it('flushes every open document before crossing a navigation barrier', async () => {
    const left = createNoteDraftState(undefined, 'draft:left');
    const right = createNoteDraftState(undefined, 'draft:right');
    const flushAllPaneCursorSaves = vi.fn();
    const cancelPendingAutosave = vi.fn();
    const enqueueSave = vi.fn(async () => {});
    const service = createWorkspacePersistenceService({
      flushAllPaneCursorSaves,
      getDocuments: () => [left, right],
      cancelPendingAutosave,
      enqueueSave
    });

    await service.flushAllForNavigation();

    expect(flushAllPaneCursorSaves).toHaveBeenCalledOnce();
    expect(cancelPendingAutosave).toHaveBeenCalledTimes(2);
    expect(cancelPendingAutosave).toHaveBeenNthCalledWith(1, left);
    expect(cancelPendingAutosave).toHaveBeenNthCalledWith(2, right);
    expect(enqueueSave).toHaveBeenCalledTimes(2);
    expect(enqueueSave).toHaveBeenNthCalledWith(1, left);
    expect(enqueueSave).toHaveBeenNthCalledWith(2, right);
  });
});

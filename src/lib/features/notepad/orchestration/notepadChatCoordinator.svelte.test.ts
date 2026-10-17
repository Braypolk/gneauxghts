import { describe, expect, it, vi } from 'vitest';
import { NotepadChatCoordinator } from './notepadChatCoordinator.svelte';

describe('Pi chat pane surface lifetime', () => {
  it('retains binding and composer handle across ordinary focus, then disposes only the retired pane', () => {
    const coordinator = new NotepadChatCoordinator(['left', 'right'], { getActivePaneId: () => 'left', getPaneKind: () => 'chat', startNewNote: async () => {}, forgetNote: async () => {}, unforgetNote: async () => {} });
    try {
      const left = coordinator.getBinding('left'), right = coordinator.getBinding('right'), focus = vi.fn(() => true);
      coordinator.setSurfaceHandle('left', { focusComposer: focus }); expect(coordinator.focusComposer('left')).toBe(true);
      expect(coordinator.getBinding('left')).toBe(left); expect(coordinator.getBinding('right')).toBe(right);
      coordinator.disposePane('left'); expect(coordinator.focusComposer('left')).toBe(false); expect(coordinator.getBinding('right')).toBe(right);
    } finally { coordinator.dispose(); }
  });
});

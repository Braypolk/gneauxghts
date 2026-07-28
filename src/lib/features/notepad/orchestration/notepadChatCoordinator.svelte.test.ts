import { describe, expect, it, vi } from 'vitest';
import {
  NotepadChatCoordinator,
  type NotepadChatCoordinatorDeps
} from './notepadChatCoordinator.svelte';

describe('NotepadChatCoordinator chat surface registry', () => {
  it('focuses registered pane surfaces and releases them when unmounted', () => {
    const coordinator = new NotepadChatCoordinator(
      [],
      {} as NotepadChatCoordinatorDeps<'chat'>
    );
    const focusComposer = vi.fn(() => true);

    expect(coordinator.focusComposer('chat')).toBe(false);

    coordinator.setSurfaceHandle('chat', { focusComposer });
    expect(coordinator.focusComposer('chat')).toBe(true);
    expect(focusComposer).toHaveBeenCalledTimes(1);

    coordinator.setSurfaceHandle('chat', null);
    expect(coordinator.focusComposer('chat')).toBe(false);
  });
});

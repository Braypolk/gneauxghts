import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const loadForgottenNotesSliceMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('$lib/app/appStore.svelte', () => ({
  appStore: {
    bootstrap: vi.fn().mockResolvedValue(undefined),
    subscribeVaultNoteChanged: vi.fn(() => () => undefined),
    subscribeSemanticStatusChanged: vi.fn(() => () => undefined)
  }
}));
vi.mock('$lib/features/atlas/atlasStore.svelte', () => ({
  atlasStore: { invalidateCachedResponse: vi.fn() }
}));
vi.mock('./loaders/forgottenLoader', () => ({
  loadForgottenNotesSlice: loadForgottenNotesSliceMock
}));

describe('SettingsStore forgotten item actions', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    loadForgottenNotesSliceMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    loadForgottenNotesSliceMock.mockResolvedValue([]);
  });

  it('keeps component-passed actions bound to the settings store', async () => {
    const { createSettingsStore } = await import('./store.svelte');
    const store = createSettingsStore();
    const forgottenPath = '/vault/.forgotten/2026-07-28-chat';
    store.selectedForgottenPaths = [forgottenPath];

    const runForgottenAction = store.runForgottenAction;
    const toggleForgottenSelection = store.toggleForgottenSelection;
    await runForgottenAction('restore_forgotten_notes', [forgottenPath]);
    toggleForgottenSelection(forgottenPath, true);

    expect(invokeMock).toHaveBeenCalledWith('restore_forgotten_notes', {
      forgottenPaths: [forgottenPath]
    });
    expect(loadForgottenNotesSliceMock).toHaveBeenCalledOnce();
    expect(store.selectedForgottenPaths).toEqual([forgottenPath]);
    expect(store.isUpdatingForgottenNotes).toBe(false);
  });
});

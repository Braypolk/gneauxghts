import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const storage = new Map<string, string>();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('forgotten-note retention preference', () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    storage.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('changes the visible preference only after backend acknowledgement', async () => {
    let acknowledge!: () => void;
    invokeMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      })
    );
    const { appSettings, setForgottenNoteRetentionPreference } = await import(
      './appSettings.svelte'
    );

    const update = setForgottenNoteRetentionPreference(30);

    expect(appSettings.forgottenNoteRetentionPreference).toBe(7);
    expect(storage.get('gneauxghts.forgotten-note-retention-days')).toBeUndefined();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('set_forgotten_note_retention_days', {
        retentionDays: 30
      });
    });

    acknowledge();
    await update;

    expect(appSettings.forgottenNoteRetentionPreference).toBe(30);
    expect(storage.get('gneauxghts.forgotten-note-retention-days')).toBeUndefined();
  });

  it('loads the canonical preference from the backend without consulting stale local storage', async () => {
    storage.set('gneauxghts.forgotten-note-retention-days', '1');
    invokeMock.mockResolvedValueOnce(30);
    const { appSettings, loadForgottenNoteRetentionPreference } = await import(
      './appSettings.svelte'
    );

    await loadForgottenNoteRetentionPreference();

    expect(invokeMock).toHaveBeenCalledWith('get_forgotten_note_retention_days');
    expect(appSettings.forgottenNoteRetentionPreference).toBe(30);
    expect(storage.get('gneauxghts.forgotten-note-retention-days')).toBe('1');
  });
});

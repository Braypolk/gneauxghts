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
  it('serializes set/set/load and lets the queue recover after a rejected write', async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: () => void;
    invokeMock.mockReturnValueOnce(new Promise<void>((_yes, no) => { rejectFirst = no; }))
      .mockReturnValueOnce(new Promise<void>(yes => { resolveSecond = yes; }))
      .mockResolvedValueOnce(1);
    const { appSettings, setForgottenNoteRetentionPreference: set, loadForgottenNoteRetentionPreference: load } = await import('./appSettings.svelte');
    const first = set(30); const firstError = expect(first).rejects.toThrow('offline');
    const second = set(1); const loading = load();
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(appSettings.forgottenNoteRetentionPreference).toBe(7);
    rejectFirst(new Error('offline')); await firstError;
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock.mock.calls[1]).toEqual(['set_forgotten_note_retention_days', { retentionDays: 1 }]);
    expect(appSettings.forgottenNoteRetentionPreference).toBe(7);
    resolveSecond(); await second; await loading;
    expect(invokeMock.mock.calls.map(call => call[0])).toEqual(['set_forgotten_note_retention_days', 'set_forgotten_note_retention_days', 'get_forgotten_note_retention_days']);
    expect(appSettings.forgottenNoteRetentionPreference).toBe(1);
  });

  it.each([0, 2, 365, null, '30'])('rejects an invalid backend preference %s without changing the visible value', async (value) => {
    const { appSettings, loadForgottenNoteRetentionPreference } = await import('./appSettings.svelte');
    invokeMock.mockResolvedValueOnce(value);
    await expect(loadForgottenNoteRetentionPreference()).rejects.toThrow('Unsupported forgotten-note retention preference');
    expect(appSettings.forgottenNoteRetentionPreference).toBe(7);
  });

});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('#lib/tauriRuntime.js', () => ({ isTauriRuntime: () => native.enabled }));

let storage: Map<string, string>;
let change: ((event: { matches: boolean }) => void) | undefined;
let systemChange: ((event: { payload: 'light' | 'dark' }) => void) | undefined;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  native.enabled = false;
  native.invoke.mockReset();
  native.listen.mockReset();
  storage = new Map();
  change = undefined;
  systemChange = undefined;
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    matchMedia: () => ({ matches: true, addEventListener: (_: string, fn: typeof change) => { change = fn; }, removeEventListener: vi.fn() })
  });
  native.listen.mockImplementation(async (_event, handler) => { systemChange = handler; return vi.fn(); });
});

afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });

describe('app logo preference', () => {
  it('defaults to the system appearance and follows subsequent system changes', async () => {
    const { appLogo } = await import('./appLogo.svelte.js');
    stop = appLogo.initialize();
    expect(appLogo.preference).toBe('auto');
    expect(appLogo.resolved).toBe('dark');
    change?.({ matches: false });
    expect(appLogo.resolved).toBe('light');
  });

  it('persists an explicit choice while system changes continue behind it', async () => {
    const { appLogo } = await import('./appLogo.svelte.js');
    stop = appLogo.initialize();
    appLogo.setPreference('light');
    change?.({ matches: true });
    expect(appLogo.resolved).toBe('light');
    expect(storage.get('gneauxghts.logo-preference')).toBe('light');
    appLogo.setPreference('auto');
    expect(appLogo.resolved).toBe('dark');
  });

  it('restores a saved logo independently of the interface theme', async () => {
    storage.set('gneauxghts.theme-preference', 'dark');
    storage.set('gneauxghts.logo-preference', 'light');
    const { appLogo } = await import('./appLogo.svelte.js');
    expect(appLogo.preference).toBe('light');
    expect(appLogo.resolved).toBe('light');
  });

  it('uses the actual native system appearance when the webview appearance differs', async () => {
    native.enabled = true;
    native.invoke.mockImplementation(async command => command === 'get_system_logo_theme' ? 'light' : undefined);
    const { appLogo } = await import('./appLogo.svelte.js');
    stop = appLogo.initialize();
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('set_app_logo', { theme: 'light' }));
    change?.({ matches: true });
    expect(appLogo.resolved).toBe('light');
    systemChange?.({ payload: 'dark' });
    expect(appLogo.resolved).toBe('dark');
    await vi.waitFor(() => expect(native.invoke).toHaveBeenLastCalledWith('set_app_logo', { theme: 'dark' }));
  });

  it('serializes native changes so the latest user choice wins', async () => {
    native.enabled = true;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    native.invoke.mockImplementationOnce(() => pending).mockResolvedValue(undefined);
    const { appLogo } = await import('./appLogo.svelte.js');
    appLogo.setPreference('light');
    appLogo.setPreference('dark');
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(1));
    finish();
    await vi.waitFor(() => expect(native.invoke).toHaveBeenLastCalledWith('set_app_logo', { theme: 'dark' }));
  });

  it('exposes a native update failure and retries the selected logo', async () => {
    native.enabled = true;
    native.invoke.mockRejectedValueOnce(new Error('Icon update failed')).mockResolvedValue(undefined);
    const { appLogo } = await import('./appLogo.svelte.js');
    appLogo.setPreference('dark');
    await vi.waitFor(() => expect(appLogo.error).toContain('Icon update failed'));
    appLogo.retry();
    await vi.waitFor(() => expect(appLogo.error).toBeNull());
  });
});

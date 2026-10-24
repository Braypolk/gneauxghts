import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from '#lib/tauriRuntime.js';

export type LogoPreference = 'auto' | 'light' | 'dark';
export type LogoTheme = Exclude<LogoPreference, 'auto'>;
const STORAGE_KEY = 'gneauxghts.logo-preference';

export const logoOptions = [
  { id: 'auto', label: 'Auto', description: 'Follow your system appearance.' },
  { id: 'light', label: 'Light', description: 'Always use the light logo.' },
  { id: 'dark', label: 'Dark', description: 'Always use the dark logo.' }
] as const;

function browserSystemTheme(): LogoTheme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedPreference(): LogoPreference {
  if (typeof window === 'undefined') return 'auto';
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : 'auto';
}

class AppLogoStore {
  preference = $state<LogoPreference>(storedPreference());
  systemTheme = $state<LogoTheme>(browserSystemTheme());
  resolved = $derived(this.preference === 'auto' ? this.systemTheme : this.preference);
  error = $state<string | null>(null);
  #nativeWrites: Promise<void> = Promise.resolve();

  initialize = (): (() => void) => {
    let disposed = false;
    let nativeSystemTheme = false;
    let systemRevision = 0;
    let unlisten: (() => void) | undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      if (!nativeSystemTheme) {
        this.systemTheme = event.matches ? 'dark' : 'light';
        this.#apply();
      }
    };
    this.systemTheme = media.matches ? 'dark' : 'light';
    media.addEventListener('change', onChange);
    if (this.#native()) {
      void (async () => {
        const stop = await listen<LogoTheme>('app://system-logo-theme-changed', ({ payload }) => {
          systemRevision++;
          nativeSystemTheme = true;
          this.systemTheme = payload;
          this.#apply();
        });
        if (disposed) { stop(); return; }
        unlisten = stop;
        const revision = systemRevision;
        const theme = await invoke<LogoTheme | null>('get_system_logo_theme');
        if (disposed) return;
        nativeSystemTheme = theme !== null;
        if (theme && revision === systemRevision) this.systemTheme = theme;
        this.#apply();
      })().catch(error => {
        if (!disposed) this.error = `Could not read the system logo appearance: ${String(error)}`;
      });
    }
    return () => {
      disposed = true;
      unlisten?.();
      media.removeEventListener('change', onChange);
    };
  };

  setPreference = (preference: LogoPreference): void => {
    this.preference = preference;
    window.localStorage.setItem(STORAGE_KEY, preference);
    this.#apply();
  };

  retry = (): void => { this.#apply(); };

  #native = (): boolean => isTauriRuntime() && import.meta.env.VITE_E2E_BROWSER !== 'true';

  #apply = (): void => {
    if (!this.#native()) return;
    // Serialize AppKit updates so an earlier choice cannot land after a later one.
    const theme = this.resolved;
    this.#nativeWrites = this.#nativeWrites.then(async () => {
      await invoke('set_app_logo', { theme });
      this.error = null;
    }).catch(error => { this.error = `Could not update the app logo: ${String(error)}`; });
  };
}

export const appLogo = new AppLogoStore();

import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '$lib/tauriRuntime';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'gneauxghts.theme-preference';

export const themeOptions = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Follow the system appearance and update when macOS changes.'
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Always use the light theme.'
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Always use the dark theme.'
  }
] as const satisfies ReadonlyArray<{
  id: ThemePreference;
  label: string;
  description: string;
}>;

class ThemeStore {
  preference = $state<ThemePreference>(readStoredThemePreference());
  resolved = $state<ResolvedTheme>(resolveInitialTheme(readStoredThemePreference()));

  #initializePromise: Promise<void> | null = null;
  #stopNativeThemeListener: (() => void) | null = null;
  #stopBrowserThemeListener: (() => void) | null = null;

  constructor() {
    if (isBrowser()) {
      this.#applyResolvedTheme(resolveInitialTheme(this.preference));
    }
  }

  initialize = (): Promise<void> => {
    if (this.#initializePromise) {
      return this.#initializePromise;
    }

    this.#initializePromise = (async () => {
      await this.#subscribeToSystemThemeChanges();
      await this.#syncResolvedTheme();
      await this.#syncNativeThemePreference(this.preference);
      await this.#syncResolvedTheme();
    })().catch((error) => {
      console.error('Failed to initialize theme handling:', error);
      this.#applyResolvedTheme(resolveInitialTheme(this.preference));
    });

    return this.#initializePromise;
  };

  setPreference = async (nextPreference: ThemePreference): Promise<void> => {
    this.preference = nextPreference;
    persistThemePreference(nextPreference);

    if (nextPreference === 'auto') {
      this.#applyResolvedTheme(readBrowserSystemTheme());
    } else {
      this.#applyResolvedTheme(nextPreference);
    }

    try {
      await this.#syncNativeThemePreference(nextPreference);
      await this.#syncResolvedTheme();
    } catch (error) {
      console.error('Failed to update theme preference:', error);
    }
  };

  #applyResolvedTheme = (theme: ResolvedTheme): void => {
    this.resolved = theme;

    if (!isBrowser()) {
      return;
    }

    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
  };

  #syncResolvedTheme = async (): Promise<void> => {
    const preference = this.preference;
    if (preference === 'light' || preference === 'dark') {
      this.#applyResolvedTheme(preference);
      return;
    }

    const nativeTheme = await readNativeTheme();
    this.#applyResolvedTheme(nativeTheme ?? readBrowserSystemTheme());
  };

  #syncNativeThemePreference = async (preference: ThemePreference): Promise<void> => {
    if (!isTauriRuntime()) {
      return;
    }

    const { setTheme } = await import('@tauri-apps/api/app');
    await setTheme(preference === 'auto' ? null : preference);
  };

  #subscribeToSystemThemeChanges = async (): Promise<void> => {
    if (this.#stopNativeThemeListener || this.#stopBrowserThemeListener) {
      return;
    }

    if (isTauriRuntime()) {
      this.#stopNativeThemeListener = await getCurrentWindow().onThemeChanged(({ payload }) => {
        if (this.preference === 'auto') {
          this.#applyResolvedTheme(payload);
        }
      });
      return;
    }

    if (!isBrowser()) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (this.preference === 'auto') {
        this.#applyResolvedTheme(event.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    this.#stopBrowserThemeListener = () => mediaQuery.removeEventListener('change', handleChange);
  };
}

export const themeStore = new ThemeStore();

export function initializeTheme(): Promise<void> {
  return themeStore.initialize();
}

export async function setThemePreference(nextPreference: ThemePreference): Promise<void> {
  await themeStore.setPreference(nextPreference);
}

function readStoredThemePreference(): ThemePreference {
  if (!isBrowser()) {
    return 'auto';
  }

  const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedPreference === 'auto' || storedPreference === 'light' || storedPreference === 'dark') {
    return storedPreference;
  }

  return 'auto';
}

function persistThemePreference(preference: ThemePreference): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
}

function resolveInitialTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'auto' ? readBrowserSystemTheme() : preference;
}

function readBrowserSystemTheme(): ResolvedTheme {
  if (!isBrowser()) {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function readNativeTheme(): Promise<ResolvedTheme | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return await getCurrentWindow().theme();
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

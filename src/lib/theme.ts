import { get, writable } from 'svelte/store';

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

export const themePreference = writable<ThemePreference>(readStoredThemePreference());
export const resolvedTheme = writable<ResolvedTheme>(resolveInitialTheme(readStoredThemePreference()));

let initializeThemePromise: Promise<void> | null = null;
let stopNativeThemeListener: (() => void) | null = null;
let stopBrowserThemeListener: (() => void) | null = null;

if (isBrowser()) {
  applyResolvedTheme(resolveInitialTheme(get(themePreference)));
}

export function initializeTheme(): Promise<void> {
  if (initializeThemePromise) {
    return initializeThemePromise;
  }

  initializeThemePromise = (async () => {
    await subscribeToSystemThemeChanges();
    await syncResolvedTheme();
    await syncNativeThemePreference(get(themePreference));
    await syncResolvedTheme();
  })().catch((error) => {
    console.error('Failed to initialize theme handling:', error);
    applyResolvedTheme(resolveInitialTheme(get(themePreference)));
  });

  return initializeThemePromise;
}

export async function setThemePreference(nextPreference: ThemePreference): Promise<void> {
  themePreference.set(nextPreference);
  persistThemePreference(nextPreference);

  if (nextPreference === 'auto') {
    applyResolvedTheme(readBrowserSystemTheme());
  } else {
    applyResolvedTheme(nextPreference);
  }

  try {
    await syncNativeThemePreference(nextPreference);
    await syncResolvedTheme();
  } catch (error) {
    console.error('Failed to update theme preference:', error);
  }
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

function applyResolvedTheme(theme: ResolvedTheme): void {
  resolvedTheme.set(theme);

  if (!isBrowser()) {
    return;
  }

  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  document.documentElement.dataset.theme = theme;
}

async function syncResolvedTheme(): Promise<void> {
  const preference = get(themePreference);
  if (preference === 'light' || preference === 'dark') {
    applyResolvedTheme(preference);
    return;
  }

  const nativeTheme = await readNativeTheme();
  applyResolvedTheme(nativeTheme ?? readBrowserSystemTheme());
}

async function syncNativeThemePreference(preference: ThemePreference): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const { setTheme } = await import('@tauri-apps/api/app');
  await setTheme(preference === 'auto' ? null : preference);
}

async function readNativeTheme(): Promise<ResolvedTheme | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return await getCurrentWindow().theme();
}

async function subscribeToSystemThemeChanges(): Promise<void> {
  if (stopNativeThemeListener || stopBrowserThemeListener) {
    return;
  }

  if (isTauriRuntime()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    stopNativeThemeListener = await getCurrentWindow().onThemeChanged(({ payload }) => {
      if (get(themePreference) === 'auto') {
        applyResolvedTheme(payload);
      }
    });
    return;
  }

  if (!isBrowser()) {
    return;
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = (event: MediaQueryListEvent) => {
    if (get(themePreference) === 'auto') {
      applyResolvedTheme(event.matches ? 'dark' : 'light');
    }
  };

  mediaQuery.addEventListener('change', handleChange);
  stopBrowserThemeListener = () => mediaQuery.removeEventListener('change', handleChange);
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isTauriRuntime(): boolean {
  return isBrowser() && '__TAURI_INTERNALS__' in window;
}

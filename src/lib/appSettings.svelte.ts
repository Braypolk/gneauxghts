import { invoke } from '@tauri-apps/api/core';

export type ForgetButtonDurationPreference = 'none' | 'short' | 'medium' | 'long';
export type ForgottenNoteRetentionPreference = 1 | 7 | 30;

const FORGET_BUTTON_DURATION_STORAGE_KEY = 'gneauxghts.forget-button-duration';
let retentionPreferenceWrite: Promise<void> = Promise.resolve();

const FORGET_BUTTON_DURATION_MS: Record<ForgetButtonDurationPreference, number> = {
  none: 0,
  short: 250,
  medium: 500,
  long: 1000
};

export const forgetButtonDurationOptions = [
  {
    id: 'none',
    label: 'None',
    description: 'Forget immediately with a single press.'
  },
  {
    id: 'short',
    label: 'Short',
    description: 'Use a quick hold before forgetting.'
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Use the current default hold duration.'
  },
  {
    id: 'long',
    label: 'Long',
    description: 'Require a longer hold before forgetting.'
  }
] as const satisfies ReadonlyArray<{
  id: ForgetButtonDurationPreference;
  label: string;
  description: string;
}>;

export const forgottenNoteRetentionOptions = [
  {
    id: 1,
    label: '1 day',
    description: 'Delete forgotten notes and chats after one day.'
  },
  {
    id: 7,
    label: '7 days',
    description: 'Keep forgotten notes and chats for one week.'
  },
  {
    id: 30,
    label: '30 days',
    description: 'Keep forgotten notes and chats for one month.'
  }
] as const satisfies ReadonlyArray<{
  id: ForgottenNoteRetentionPreference;
  label: string;
  description: string;
}>;

class AppSettingsStore {
  forgetButtonDurationPreference = $state<ForgetButtonDurationPreference>(
    readStoredForgetButtonDurationPreference()
  );
  forgottenNoteRetentionPreference = $state<ForgottenNoteRetentionPreference>(7);

  setForgetButtonDurationPreference = (nextPreference: ForgetButtonDurationPreference): void => {
    this.forgetButtonDurationPreference = nextPreference;
    persistForgetButtonDurationPreference(nextPreference);
  };

  setForgottenNoteRetentionPreference = async (
    nextPreference: ForgottenNoteRetentionPreference
  ): Promise<void> => {
    const write = retentionPreferenceWrite.catch(() => undefined).then(async () => {
      if (!isBrowser()) return;
      await invoke('set_forgotten_note_retention_days', { retentionDays: nextPreference });
      this.forgottenNoteRetentionPreference = nextPreference;
    });
    retentionPreferenceWrite = write;
    await write;
  };

  loadForgottenNoteRetentionPreference = async (): Promise<void> => {
    const load = retentionPreferenceWrite.catch(() => undefined).then(async () => {
      if (!isBrowser()) return;
      const preference = await invoke<number>('get_forgotten_note_retention_days');
      if (preference !== 1 && preference !== 7 && preference !== 30) {
        throw new Error(`Unsupported forgotten-note retention preference: ${preference}`);
      }
      this.forgottenNoteRetentionPreference = preference;
    });
    retentionPreferenceWrite = load;
    await load;
  };
}

export const appSettings = new AppSettingsStore();

export function setForgetButtonDurationPreference(
  nextPreference: ForgetButtonDurationPreference
): void {
  appSettings.setForgetButtonDurationPreference(nextPreference);
}

export function resolveForgetButtonDurationMs(
  preference: ForgetButtonDurationPreference
): number {
  return FORGET_BUTTON_DURATION_MS[preference];
}

export async function setForgottenNoteRetentionPreference(
  nextPreference: ForgottenNoteRetentionPreference
): Promise<void> {
  await appSettings.setForgottenNoteRetentionPreference(nextPreference);
}

export function loadForgottenNoteRetentionPreference(): Promise<void> {
  return appSettings.loadForgottenNoteRetentionPreference();
}

function readStoredForgetButtonDurationPreference(): ForgetButtonDurationPreference {
  if (!isBrowser()) {
    return 'medium';
  }

  const storedPreference = window.localStorage.getItem(FORGET_BUTTON_DURATION_STORAGE_KEY);
  if (
    storedPreference === 'none' ||
    storedPreference === 'short' ||
    storedPreference === 'medium' ||
    storedPreference === 'long'
  ) {
    return storedPreference;
  }

  return 'medium';
}

function persistForgetButtonDurationPreference(
  preference: ForgetButtonDurationPreference
): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(FORGET_BUTTON_DURATION_STORAGE_KEY, preference);
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

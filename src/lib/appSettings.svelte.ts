export type ForgetButtonDurationPreference = 'none' | 'short' | 'medium' | 'long';
export type ForgottenNoteRetentionPreference = 1 | 7 | 30;

const FORGET_BUTTON_DURATION_STORAGE_KEY = 'gneauxghts.forget-button-duration';
const FORGOTTEN_NOTE_RETENTION_STORAGE_KEY = 'gneauxghts.forgotten-note-retention-days';

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
    description: 'Delete forgotten notes after one day.'
  },
  {
    id: 7,
    label: '7 days',
    description: 'Keep forgotten notes for one week.'
  },
  {
    id: 30,
    label: '30 days',
    description: 'Keep forgotten notes for one month.'
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
  forgottenNoteRetentionPreference = $state<ForgottenNoteRetentionPreference>(
    readStoredForgottenNoteRetentionPreference()
  );

  setForgetButtonDurationPreference = (nextPreference: ForgetButtonDurationPreference): void => {
    this.forgetButtonDurationPreference = nextPreference;
    persistForgetButtonDurationPreference(nextPreference);
  };

  setForgottenNoteRetentionPreference = (
    nextPreference: ForgottenNoteRetentionPreference
  ): void => {
    this.forgottenNoteRetentionPreference = nextPreference;
    persistForgottenNoteRetentionPreference(nextPreference);
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

export function setForgottenNoteRetentionPreference(
  nextPreference: ForgottenNoteRetentionPreference
): void {
  appSettings.setForgottenNoteRetentionPreference(nextPreference);
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

function readStoredForgottenNoteRetentionPreference(): ForgottenNoteRetentionPreference {
  if (!isBrowser()) {
    return 7;
  }

  const storedPreference = window.localStorage.getItem(FORGOTTEN_NOTE_RETENTION_STORAGE_KEY);
  if (storedPreference === '1') return 1;
  if (storedPreference === '7') return 7;
  if (storedPreference === '30') return 30;

  return 7;
}

function persistForgetButtonDurationPreference(
  preference: ForgetButtonDurationPreference
): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(FORGET_BUTTON_DURATION_STORAGE_KEY, preference);
}

function persistForgottenNoteRetentionPreference(
  preference: ForgottenNoteRetentionPreference
): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(FORGOTTEN_NOTE_RETENTION_STORAGE_KEY, String(preference));
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

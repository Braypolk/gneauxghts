import { writable } from 'svelte/store';

export type ForgetButtonDurationPreference = 'none' | 'short' | 'medium' | 'long';
export type ForgottenNoteRetentionPreference = 1 | 7 | 30;
export type RememberModePreference = 'exact' | 'cleanUp' | 'integrate';
export type CleanUpApplyPolicyPreference = 'autoApply' | 'requireApproval';

const FORGET_BUTTON_DURATION_STORAGE_KEY = 'gneauxghts.forget-button-duration';
const FORGOTTEN_NOTE_RETENTION_STORAGE_KEY = 'gneauxghts.forgotten-note-retention-days';
const DEFAULT_REMEMBER_MODE_STORAGE_KEY = 'gneauxghts.default-remember-mode';
const CLEAN_UP_APPLY_POLICY_STORAGE_KEY = 'gneauxghts.cleanup-apply-policy';

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

export const forgetButtonDurationPreference = writable<ForgetButtonDurationPreference>(
  readStoredForgetButtonDurationPreference()
);

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

export const forgottenNoteRetentionPreference = writable<ForgottenNoteRetentionPreference>(
  readStoredForgottenNoteRetentionPreference()
);

export const rememberModeOptions = [
  {
    id: 'exact',
    label: 'Exact',
    description: 'Save exactly as written.'
  },
  {
    id: 'cleanUp',
    label: 'Clean Up',
    description: 'Have AI lightly rewrite the note.'
  },
  {
    id: 'integrate',
    label: 'Integrate',
    description: 'Have AI fit the note into the vault.'
  }
] as const satisfies ReadonlyArray<{
  id: RememberModePreference;
  label: string;
  description: string;
}>;

export const cleanUpApplyPolicyOptions = [
  {
    id: 'autoApply',
    label: 'Auto-apply',
    description: 'Apply cleanup results immediately and log them to Inbox.'
  },
  {
    id: 'requireApproval',
    label: 'Require approval',
    description: 'Send cleanup results to Inbox before they are applied.'
  }
] as const satisfies ReadonlyArray<{
  id: CleanUpApplyPolicyPreference;
  label: string;
  description: string;
}>;

export const defaultRememberModePreference = writable<RememberModePreference>(
  readStoredDefaultRememberModePreference()
);

export const cleanUpApplyPolicyPreference = writable<CleanUpApplyPolicyPreference>(
  readStoredCleanUpApplyPolicyPreference()
);

export function setForgetButtonDurationPreference(
  nextPreference: ForgetButtonDurationPreference
): void {
  forgetButtonDurationPreference.set(nextPreference);
  persistForgetButtonDurationPreference(nextPreference);
}

export function resolveForgetButtonDurationMs(
  preference: ForgetButtonDurationPreference
): number {
  return FORGET_BUTTON_DURATION_MS[preference];
}

export function setForgottenNoteRetentionPreference(
  nextPreference: ForgottenNoteRetentionPreference
): void {
  forgottenNoteRetentionPreference.set(nextPreference);
  persistForgottenNoteRetentionPreference(nextPreference);
}

export function setDefaultRememberModePreference(nextPreference: RememberModePreference): void {
  defaultRememberModePreference.set(nextPreference);
  persistDefaultRememberModePreference(nextPreference);
}

export function setCleanUpApplyPolicyPreference(
  nextPreference: CleanUpApplyPolicyPreference
): void {
  cleanUpApplyPolicyPreference.set(nextPreference);
  persistCleanUpApplyPolicyPreference(nextPreference);
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

function readStoredDefaultRememberModePreference(): RememberModePreference {
  if (!isBrowser()) {
    return 'exact';
  }

  const storedPreference = window.localStorage.getItem(DEFAULT_REMEMBER_MODE_STORAGE_KEY);
  if (
    storedPreference === 'exact' ||
    storedPreference === 'cleanUp' ||
    storedPreference === 'integrate'
  ) {
    return storedPreference;
  }

  return 'exact';
}

function readStoredCleanUpApplyPolicyPreference(): CleanUpApplyPolicyPreference {
  if (!isBrowser()) {
    return 'autoApply';
  }

  const storedPreference = window.localStorage.getItem(CLEAN_UP_APPLY_POLICY_STORAGE_KEY);
  if (storedPreference === 'autoApply' || storedPreference === 'requireApproval') {
    return storedPreference;
  }

  return 'autoApply';
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

function persistDefaultRememberModePreference(preference: RememberModePreference): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(DEFAULT_REMEMBER_MODE_STORAGE_KEY, preference);
}

function persistCleanUpApplyPolicyPreference(preference: CleanUpApplyPolicyPreference): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(CLEAN_UP_APPLY_POLICY_STORAGE_KEY, preference);
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

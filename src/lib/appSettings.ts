import { writable } from 'svelte/store';

export type ForgetButtonDurationPreference = 'none' | 'short' | 'medium' | 'long';

const FORGET_BUTTON_DURATION_STORAGE_KEY = 'gneauxghts.forget-button-duration';

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

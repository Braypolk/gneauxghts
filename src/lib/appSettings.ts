import { derived, writable } from 'svelte/store';
import {
  defaultEditableRememberActions,
  editableRememberActionToOption,
  EXACT_REMEMBER_ACTION,
  type EditableRememberAction
} from '$lib/types/ai';

export type ForgetButtonDurationPreference = 'none' | 'short' | 'medium' | 'long';
export type ForgottenNoteRetentionPreference = 1 | 7 | 30;
export type RememberActionPreference = string;
export type CleanUpApplyPolicyPreference = 'autoApply' | 'requireApproval';

const FORGET_BUTTON_DURATION_STORAGE_KEY = 'gneauxghts.forget-button-duration';
const FORGOTTEN_NOTE_RETENTION_STORAGE_KEY = 'gneauxghts.forgotten-note-retention-days';
const DEFAULT_REMEMBER_ACTION_STORAGE_KEY = 'gneauxghts.default-remember-action';
const CLEAN_UP_APPLY_POLICY_STORAGE_KEY = 'gneauxghts.cleanup-apply-policy';
const REMEMBER_ACTIONS_STORAGE_KEY = 'gneauxghts.remember-actions';
const LEGACY_CUSTOM_REMEMBER_ACTIONS_STORAGE_KEY = 'gneauxghts.custom-remember-actions';

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

export const rememberActions = writable<EditableRememberAction[]>(readStoredRememberActions());

export const rememberActionOptions = derived(rememberActions, ($rememberActions) => [
  EXACT_REMEMBER_ACTION,
  ...$rememberActions
    .filter((action) => action.visible)
    .map(editableRememberActionToOption)
]);

export const cleanUpApplyPolicyOptions = [
  {
    id: 'autoApply',
    label: 'Auto-apply',
    description: 'Apply single-note AI transform results immediately and log them to Inbox.'
  },
  {
    id: 'requireApproval',
    label: 'Require approval',
    description: 'Send single-note AI transform results to Inbox before they are applied.'
  }
] as const satisfies ReadonlyArray<{
  id: CleanUpApplyPolicyPreference;
  label: string;
  description: string;
}>;

export const defaultRememberActionPreference = writable<RememberActionPreference>(
  readStoredDefaultRememberActionPreference()
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

export function setDefaultRememberActionPreference(nextPreference: RememberActionPreference): void {
  defaultRememberActionPreference.set(nextPreference);
  persistDefaultRememberActionPreference(nextPreference);
}

export function setCleanUpApplyPolicyPreference(
  nextPreference: CleanUpApplyPolicyPreference
): void {
  cleanUpApplyPolicyPreference.set(nextPreference);
  persistCleanUpApplyPolicyPreference(nextPreference);
}

export function setRememberActions(nextActions: EditableRememberAction[]): void {
  rememberActions.set(nextActions);
  persistRememberActions(nextActions);
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

function readStoredDefaultRememberActionPreference(): RememberActionPreference {
  if (!isBrowser()) {
    return 'exact';
  }

  const storedPreference = window.localStorage.getItem(DEFAULT_REMEMBER_ACTION_STORAGE_KEY);
  if (storedPreference && storedPreference.trim() !== '') {
    return storedPreference;
  }

  return 'exact';
}

function readStoredRememberActions(): EditableRememberAction[] {
  if (!isBrowser()) {
    return defaultEditableRememberActions.map((action) => ({ ...action }));
  }

  const stored = readRememberActionsFromStorageKey(REMEMBER_ACTIONS_STORAGE_KEY);
  if (stored !== null) {
    return stored;
  }

  const legacy = readLegacyRememberActions();
  return [...defaultEditableRememberActions.map((action) => ({ ...action })), ...legacy];
}

function readRememberActionsFromStorageKey(
  storageKey: string
): EditableRememberAction[] | null {
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seenIds = new Set<string>();
    const normalized: EditableRememberAction[] = [];
    for (const value of parsed) {
      const action = normalizeStoredRememberAction(value);
      if (!action || action.id === 'exact' || seenIds.has(action.id)) {
        continue;
      }
      seenIds.add(action.id);
      normalized.push(action);
    }
    return normalized;
  } catch {
    return [];
  }
}

function readLegacyRememberActions(): EditableRememberAction[] {
  const raw = window.localStorage.getItem(LEGACY_CUSTOM_REMEMBER_ACTIONS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized: EditableRememberAction[] = [];
    for (const value of parsed) {
      const action = normalizeLegacyRememberAction(value);
      if (action) {
        normalized.push(action);
      }
    }
    return normalized;
  } catch {
    return [];
  }
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

function persistDefaultRememberActionPreference(preference: RememberActionPreference): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(DEFAULT_REMEMBER_ACTION_STORAGE_KEY, preference);
}

function persistRememberActions(actions: EditableRememberAction[]): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(REMEMBER_ACTIONS_STORAGE_KEY, JSON.stringify(actions));
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

function normalizeStoredRememberAction(value: unknown): EditableRememberAction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<EditableRememberAction>;
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.trim() === '' ||
    typeof candidate.label !== 'string' ||
    candidate.label.trim() === '' ||
    typeof candidate.description !== 'string' ||
    typeof candidate.prompt !== 'string' ||
    (candidate.kind !== 'singleNote' && candidate.kind !== 'advanced')
  ) {
    return null;
  }

  return {
    id: candidate.id.trim(),
    label: candidate.label.trim(),
    description: candidate.description,
    prompt: candidate.prompt,
    kind: candidate.kind,
    family: normalizeEditableFamily(candidate.family, candidate.kind, candidate.id),
    visible: candidate.visible !== false
  };
}

function normalizeLegacyRememberAction(value: unknown): EditableRememberAction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<{
    id: string;
    label: string;
    description: string;
    prompt: string;
    kind: 'singleNote' | 'advanced';
  }>;

  if (
    typeof candidate.id !== 'string' ||
    candidate.id.trim() === '' ||
    typeof candidate.label !== 'string' ||
    candidate.label.trim() === '' ||
    typeof candidate.description !== 'string' ||
    typeof candidate.prompt !== 'string' ||
    (candidate.kind !== 'singleNote' && candidate.kind !== 'advanced')
  ) {
    return null;
  }

  return {
    id: candidate.id.trim(),
    label: candidate.label.trim(),
    description: candidate.description,
    prompt: candidate.prompt,
    kind: candidate.kind,
    family: normalizeEditableFamily(undefined, candidate.kind, candidate.id),
    visible: true
  };
}

function normalizeEditableFamily(
  family: string | undefined,
  kind: EditableRememberAction['kind'],
  id: string
): EditableRememberAction['family'] {
  if (family === 'edit' || family === 'organize' || family === 'integrate') {
    return kind === 'singleNote' ? 'edit' : family;
  }

  if (kind === 'singleNote') {
    return 'edit';
  }

  return id === 'integrate' ? 'integrate' : 'organize';
}

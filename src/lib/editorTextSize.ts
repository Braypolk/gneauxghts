import { get, writable } from 'svelte/store';

export type EditorTextSizePreference = 'small' | 'medium' | 'large' | 'custom';

export type EditorTextSizeCustom = {
  /** Body text size in rem. Medium is `1`. */
  bodyRem: number;
  /**
   * Multiplier for heading sizes relative to the medium heading scale at the
   * current body size. `1` keeps the same heading:body proportions as medium.
   */
  headingScale: number;
};

export type EditorTextSizes = {
  bodyRem: number;
  h1Rem: number;
  h2Rem: number;
  h3Rem: number;
  h4Rem: number;
  h5Rem: number;
  h6Rem: number;
};

const PREFERENCE_STORAGE_KEY = 'gneauxghts.editor-text-size';
const CUSTOM_STORAGE_KEY = 'gneauxghts.editor-text-size-custom';

/** Current editor typography — treated as the medium preset. */
export const MEDIUM_EDITOR_TEXT_SIZES = {
  bodyRem: 1,
  h1Rem: 1.75,
  h2Rem: 1.375,
  h3Rem: 1.125,
  h4Rem: 1,
  h5Rem: 0.875,
  h6Rem: 0.8125
} as const satisfies EditorTextSizes;

const PRESET_SCALES: Record<Exclude<EditorTextSizePreference, 'custom'>, number> = {
  small: 0.875,
  medium: 1,
  large: 1.25
};

export const DEFAULT_CUSTOM_EDITOR_TEXT_SIZE: EditorTextSizeCustom = {
  bodyRem: MEDIUM_EDITOR_TEXT_SIZES.bodyRem,
  headingScale: 1
};

export const editorTextSizeOptions = [
  {
    id: 'small',
    label: 'Small',
    description: 'Slightly smaller body text and headings.'
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Default editor text and heading sizes.'
  },
  {
    id: 'large',
    label: 'Large',
    description: 'Larger body text and headings for easier reading.'
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Choose body and heading sizes yourself.'
  }
] as const satisfies ReadonlyArray<{
  id: EditorTextSizePreference;
  label: string;
  description: string;
}>;

export const BODY_SIZE_MIN_REM = 0.75;
export const BODY_SIZE_MAX_REM = 1.5;
export const BODY_SIZE_STEP_REM = 0.0625;
export const HEADING_SCALE_MIN = 0.75;
export const HEADING_SCALE_MAX = 1.5;
export const HEADING_SCALE_STEP = 0.05;

export const editorTextSizePreference = writable<EditorTextSizePreference>(
  readStoredPreference()
);
export const editorTextSizeCustom = writable<EditorTextSizeCustom>(readStoredCustom());

if (isBrowser()) {
  applyEditorTextSizes(
    resolveEditorTextSizes(get(editorTextSizePreference), get(editorTextSizeCustom))
  );
}

export function setEditorTextSizePreference(nextPreference: EditorTextSizePreference): void {
  if (nextPreference === 'custom') {
    const current = get(editorTextSizePreference);
    if (current !== 'custom') {
      const seeded = customFromResolved(resolveEditorTextSizes(current, get(editorTextSizeCustom)));
      editorTextSizeCustom.set(seeded);
      persistCustom(seeded);
    }
  }

  editorTextSizePreference.set(nextPreference);
  persistPreference(nextPreference);
  applyCurrentEditorTextSizes();
}

export function setEditorTextSizeCustom(nextCustom: EditorTextSizeCustom): void {
  const normalized = normalizeCustom(nextCustom);
  editorTextSizeCustom.set(normalized);
  persistCustom(normalized);

  if (get(editorTextSizePreference) !== 'custom') {
    editorTextSizePreference.set('custom');
    persistPreference('custom');
  }

  applyCurrentEditorTextSizes();
}

export function resolveEditorTextSizes(
  preference: EditorTextSizePreference,
  custom: EditorTextSizeCustom
): EditorTextSizes {
  if (preference === 'custom') {
    return sizesFromCustom(normalizeCustom(custom));
  }

  return scaleMediumSizes(PRESET_SCALES[preference]);
}

export function formatRemLabel(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Number(rounded.toFixed(3))}rem`;
}

export function formatHeadingScaleLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function applyCurrentEditorTextSizes(): void {
  applyEditorTextSizes(
    resolveEditorTextSizes(get(editorTextSizePreference), get(editorTextSizeCustom))
  );
}

function scaleMediumSizes(scale: number): EditorTextSizes {
  if (scale === 1) {
    return { ...MEDIUM_EDITOR_TEXT_SIZES };
  }

  return {
    bodyRem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.bodyRem * scale),
    h1Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h1Rem * scale),
    h2Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h2Rem * scale),
    h3Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h3Rem * scale),
    h4Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h4Rem * scale),
    h5Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h5Rem * scale),
    h6Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h6Rem * scale)
  };
}

function sizesFromCustom(custom: EditorTextSizeCustom): EditorTextSizes {
  const bodyRatio = custom.bodyRem / MEDIUM_EDITOR_TEXT_SIZES.bodyRem;
  const headingFactor = bodyRatio * custom.headingScale;

  return {
    bodyRem: roundRem(custom.bodyRem),
    h1Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h1Rem * headingFactor),
    h2Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h2Rem * headingFactor),
    h3Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h3Rem * headingFactor),
    h4Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h4Rem * headingFactor),
    h5Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h5Rem * headingFactor),
    h6Rem: roundRem(MEDIUM_EDITOR_TEXT_SIZES.h6Rem * headingFactor)
  };
}

function customFromResolved(sizes: EditorTextSizes): EditorTextSizeCustom {
  return normalizeCustom({
    bodyRem: sizes.bodyRem,
    headingScale: 1
  });
}

function normalizeCustom(custom: EditorTextSizeCustom): EditorTextSizeCustom {
  return {
    bodyRem: clamp(
      roundToStep(custom.bodyRem, BODY_SIZE_STEP_REM),
      BODY_SIZE_MIN_REM,
      BODY_SIZE_MAX_REM
    ),
    headingScale: clamp(
      roundToStep(custom.headingScale, HEADING_SCALE_STEP),
      HEADING_SCALE_MIN,
      HEADING_SCALE_MAX
    )
  };
}

function applyEditorTextSizes(sizes: EditorTextSizes): void {
  if (!isBrowser()) {
    return;
  }

  const root = document.documentElement.style;
  root.setProperty('--gn-editor-font-size', `${sizes.bodyRem}rem`);
  root.setProperty('--gn-editor-h1-size', `${sizes.h1Rem}rem`);
  root.setProperty('--gn-editor-h2-size', `${sizes.h2Rem}rem`);
  root.setProperty('--gn-editor-h3-size', `${sizes.h3Rem}rem`);
  root.setProperty('--gn-editor-h4-size', `${sizes.h4Rem}rem`);
  root.setProperty('--gn-editor-h5-size', `${sizes.h5Rem}rem`);
  root.setProperty('--gn-editor-h6-size', `${sizes.h6Rem}rem`);
}

function readStoredPreference(): EditorTextSizePreference {
  if (!isBrowser()) {
    return 'medium';
  }

  const stored = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
  if (
    stored === 'small' ||
    stored === 'medium' ||
    stored === 'large' ||
    stored === 'custom'
  ) {
    return stored;
  }

  return 'medium';
}

function readStoredCustom(): EditorTextSizeCustom {
  if (!isBrowser()) {
    return { ...DEFAULT_CUSTOM_EDITOR_TEXT_SIZE };
  }

  const stored = window.localStorage.getItem(CUSTOM_STORAGE_KEY);
  if (!stored) {
    return { ...DEFAULT_CUSTOM_EDITOR_TEXT_SIZE };
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) {
      return { ...DEFAULT_CUSTOM_EDITOR_TEXT_SIZE };
    }

    const bodyRem = typeof parsed.bodyRem === 'number' ? parsed.bodyRem : DEFAULT_CUSTOM_EDITOR_TEXT_SIZE.bodyRem;
    const headingScale =
      typeof parsed.headingScale === 'number'
        ? parsed.headingScale
        : DEFAULT_CUSTOM_EDITOR_TEXT_SIZE.headingScale;

    return normalizeCustom({ bodyRem, headingScale });
  } catch {
    return { ...DEFAULT_CUSTOM_EDITOR_TEXT_SIZE };
  }
}

function persistPreference(preference: EditorTextSizePreference): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(PREFERENCE_STORAGE_KEY, preference);
}

function persistCustom(custom: EditorTextSizeCustom): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(custom));
}

function roundRem(value: number): number {
  return Number(value.toFixed(4));
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

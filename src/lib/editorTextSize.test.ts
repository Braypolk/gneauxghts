import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MEDIUM_EDITOR_TEXT_SIZES,
  resolveEditorTextSizes,
  type EditorTextSizeCustom
} from './editorTextSize.svelte';

describe('resolveEditorTextSizes', () => {
  const custom: EditorTextSizeCustom = { bodyRem: 1, headingScale: 1 };

  it('uses current sizes for medium', () => {
    expect(resolveEditorTextSizes('medium', custom)).toEqual(MEDIUM_EDITOR_TEXT_SIZES);
  });

  it('scales small and large from medium', () => {
    expect(resolveEditorTextSizes('small', custom).bodyRem).toBe(0.875);
    expect(resolveEditorTextSizes('large', custom).bodyRem).toBe(1.25);
    expect(resolveEditorTextSizes('small', custom).h1Rem).toBe(1.5313);
    expect(resolveEditorTextSizes('large', custom).h1Rem).toBe(2.1875);
  });

  it('applies custom body and heading scale', () => {
    const sizes = resolveEditorTextSizes('custom', { bodyRem: 1.25, headingScale: 1.2 });
    expect(sizes.bodyRem).toBe(1.25);
    expect(sizes.h1Rem).toBeCloseTo(MEDIUM_EDITOR_TEXT_SIZES.h1Rem * 1.25 * 1.2, 3);
  });
});

describe('editor typography persistence and CSS', () => {
  const storage = new Map<string, string>();
  const styles = new Map<string, string>();
  beforeEach(() => {
    vi.resetModules(); storage.clear(); styles.clear();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    vi.stubGlobal('document', { documentElement: { style: { setProperty: (key: string, value: string) => styles.set(key, value) } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('seeds custom settings from the active preset and updates every CSS variable', async () => {
    storage.set('gneauxghts.editor-text-size', 'large');
    const { editorTextSize, setEditorTextSizePreference } = await import('./editorTextSize.svelte');
    const presetStyles = new Map(styles);
    setEditorTextSizePreference('custom');
    expect(editorTextSize.custom).toEqual({ bodyRem: 1.25, headingScale: 1 });
    expect(styles).toEqual(presetStyles);
    expect([...styles.keys()].sort()).toEqual(['--gn-editor-font-size', '--gn-editor-h1-size', '--gn-editor-h2-size', '--gn-editor-h3-size', '--gn-editor-h4-size', '--gn-editor-h5-size', '--gn-editor-h6-size']);
    expect(storage.get('gneauxghts.editor-text-size')).toBe('custom');
    expect(JSON.parse(storage.get('gneauxghts.editor-text-size-custom')!)).toEqual(editorTextSize.custom);
  });

  it('clamps custom limits and rounds to supported increments before persistence', async () => {
    const { editorTextSize, setEditorTextSizeCustom } = await import('./editorTextSize.svelte');
    setEditorTextSizeCustom({ bodyRem: 20, headingScale: 0 });
    expect(editorTextSize.custom).toEqual({ bodyRem: 1.5, headingScale: 0.75 });
    setEditorTextSizeCustom({ bodyRem: 1.14, headingScale: 1.12 });
    expect(editorTextSize.custom).toEqual({ bodyRem: 1.125, headingScale: 1.1 });
    expect(styles.get('--gn-editor-font-size')).toBe('1.125rem');
    expect(styles.get('--gn-editor-h1-size')).toBe('2.1656rem');
    expect(JSON.parse(storage.get('gneauxghts.editor-text-size-custom')!)).toEqual(editorTextSize.custom);
  });

  it.each(['{broken', 'null', '[]', '{"bodyRem":"large","headingScale":null}'])('recovers malformed custom storage %s', async (stored) => {
    storage.set('gneauxghts.editor-text-size', 'unknown');
    storage.set('gneauxghts.editor-text-size-custom', stored);
    const { editorTextSize } = await import('./editorTextSize.svelte');
    expect(editorTextSize.preference).toBe('medium');
    expect(editorTextSize.custom).toEqual({ bodyRem: 1, headingScale: 1 });
    expect(styles.get('--gn-editor-font-size')).toBe('1rem');
    expect(styles.size).toBe(7);
  });
});

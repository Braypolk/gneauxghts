import { describe, expect, it } from 'vitest';

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

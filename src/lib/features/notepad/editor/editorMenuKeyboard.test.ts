import { describe, expect, it } from 'vitest';

import {
  clampMenuHoverIndex,
  stepMenuHoverGroup,
  stepMenuHoverIndex
} from '$lib/features/notepad/editor/editorMenuKeyboard';
import type { EditorMenuGroupWithItems } from '$lib/features/notepad/editor/editorMenuModel';

const groups: EditorMenuGroupWithItems[] = [
  {
    key: 'text',
    label: 'Text',
    range: [0, 2],
    items: [
      { id: 'paragraph', label: 'Paragraph', index: 0 },
      { id: 'heading1', label: 'Heading 1', index: 1 }
    ]
  },
  {
    key: 'lists',
    label: 'Lists',
    range: [2, 3],
    items: [{ id: 'bulletList', label: 'Bullet list', index: 2 }]
  }
];

describe('editorMenuKeyboard', () => {
  it('clamps hover indices to menu bounds', () => {
    expect(clampMenuHoverIndex(-1, 3)).toBe(0);
    expect(clampMenuHoverIndex(5, 3)).toBe(2);
  });

  it('steps vertically within the menu', () => {
    expect(stepMenuHoverIndex(1, 'down', 3)).toBe(2);
    expect(stepMenuHoverIndex(0, 'up', 3)).toBe(0);
  });

  it('steps horizontally across groups', () => {
    expect(stepMenuHoverGroup(1, 'right', groups)).toBe(2);
    expect(stepMenuHoverGroup(2, 'left', groups)).toBe(1);
  });
});

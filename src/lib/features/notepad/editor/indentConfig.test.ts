import { describe, expect, it } from 'vitest';
import { indentUnit, indentString } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import {
  INDENT_SPACES,
  INDENT_UNIT_STRING,
  VISUAL_TAB_WIDTH,
  createIndentExtensions
} from './indentConfig';

describe('indent configuration', () => {
  it('defaults the logical indent unit to two spaces', () => {
    expect(INDENT_SPACES).toBe(2);
    expect(INDENT_UNIT_STRING).toBe('  ');
  });

  it('renders literal tabs wider than the logical indent', () => {
    expect(VISUAL_TAB_WIDTH).toBeGreaterThan(INDENT_SPACES);
  });

  it('pins the CodeMirror indentUnit facet to two spaces', () => {
    const state = EditorState.create({ extensions: createIndentExtensions() });
    expect(state.facet(indentUnit)).toBe('  ');
    // indentString is what indentMore / indentWithTab insert per level.
    expect(indentString(state, INDENT_SPACES)).toBe('  ');
  });

  it('pins the visual tab size facet', () => {
    const state = EditorState.create({ extensions: createIndentExtensions() });
    expect(state.tabSize).toBe(VISUAL_TAB_WIDTH);
  });
});

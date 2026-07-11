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
  it('configures CodeMirror with the logical indent and visual tab width', () => {
    const state = EditorState.create({ extensions: createIndentExtensions() });

    expect(INDENT_UNIT_STRING).toBe(' '.repeat(INDENT_SPACES));
    expect(state.facet(indentUnit)).toBe(INDENT_UNIT_STRING);
    expect(indentString(state, INDENT_SPACES)).toBe(INDENT_UNIT_STRING);
    expect(state.tabSize).toBe(VISUAL_TAB_WIDTH);
  });
});

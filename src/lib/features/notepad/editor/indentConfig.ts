import { indentUnit } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';

// Editor indentation defaults. These are the seam a future settings panel would
// drive; today they are constants so the behavior is fixed and testable.
//
// `INDENT_SPACES` is the *logical* indent: the actual characters inserted into
// the document when indenting (Tab, list indent, indent-on-input). Two spaces by
// default — the document never contains tab characters from our own edits.
//
// `VISUAL_TAB_WIDTH` is the *visual* width, in character columns, of a literal
// tab (`\t`) that may already exist in pasted or imported content. It is wider
// than `INDENT_SPACES` so such tabs render at a comfortable, editor-like width
// rather than collapsing to two columns. (Leading two-space indents on list
// items additionally render wider through the `--gn-depth` padding in
// editor.css, so nested lists read as comfortably indented without bloating the
// underlying markdown.)
export const INDENT_SPACES = 2;
export const VISUAL_TAB_WIDTH = 4;

export const INDENT_UNIT_STRING = ' '.repeat(INDENT_SPACES);

// CodeMirror extensions that pin the logical indent unit and the visual tab
// width. Bundled into the shared markdown baseline so both the root state and
// every pane agree on indentation.
export function createIndentExtensions(): Extension[] {
  return [indentUnit.of(INDENT_UNIT_STRING), EditorState.tabSize.of(VISUAL_TAB_WIDTH)];
}

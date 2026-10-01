import { history, redo, undo } from '@codemirror/commands';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDateTimePicker } from '$lib/features/tasks/dateTimePicker';
import { createMarkdownLanguage } from '../markdown/markdownLanguage';
import { openTaskDueDatePicker } from './taskDateExtension';

vi.mock('$lib/features/tasks/dateTimePicker', () => ({
  openDateTimePicker: vi.fn(() => vi.fn()),
  isDateTimePickerOpen: () => false
}));

function editor(doc: string) {
  let state = EditorState.create({ doc, extensions: [createMarkdownLanguage(), history()] });
  const view = {
    dom: { isConnected: true, closest: () => null },
    get state() { return state; },
    dispatch(spec: TransactionSpec) { state = state.update(spec).state; },
    focus() {}
  } as unknown as EditorView;
  return { view, undo: () => undo({ state, dispatch: (tr) => { state = tr.state; } }), redo: () => redo({ state, dispatch: (tr) => { state = tr.state; } }) };
}

function pickerOptions() {
  const call = vi.mocked(openDateTimePicker).mock.calls.at(-1);
  if (!call) throw new Error('Expected an open picker');
  return call[0];
}

describe('editor task date commits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a concurrent document edit without changing either task', () => {
    const { view } = editor('- [ ] Parent\n  - [ ] Child');
    openTaskDueDatePicker(view, 0);
    const picker = pickerOptions();
    view.dispatch({ changes: { from: 0, insert: 'New heading\n' } });
    const changed = view.state.doc.toString();
    expect(() => picker.onCommit({ date: '2026-10-02', time: null })).toThrow('The note changed');
    expect(view.state.doc.toString()).toBe(changed);
  });

  it('permits selection changes and edits only the nested task in one undo step', () => {
    const doc = '- [ ] Parent @due(2026-10-01)\n  - [ ] Child /due';
    const { view, undo, redo } = editor(doc);
    const token = { from: doc.lastIndexOf('/due'), to: doc.length };
    openTaskDueDatePicker(view, token.from, token);
    view.dispatch({ selection: { anchor: 0 } });
    pickerOptions().onCommit({ date: '2026-10-02', time: null });
    expect(view.state.doc.toString()).toBe('- [ ] Parent @due(2026-10-01)\n  - [ ] Child @due(2026-10-02) ');
    expect(undo()).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    expect(redo()).toBe(true);
    expect(view.state.doc.toString()).toContain('Child @due(2026-10-02)');
  });
});

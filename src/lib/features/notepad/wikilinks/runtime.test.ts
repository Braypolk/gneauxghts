import { describe, expect, it, vi } from 'vitest';
import { Compartment } from '@codemirror/state';
import { createCommandView } from '../editor/commandTestSupport';
import { createWikilinkRuntime } from './runtime';
import { createWikilinkAutocompleteState } from './state';
import type { EditorController } from '../editor/types';
import type { NoteLinkSuggestion } from '../model/types';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

it('keeps replacement, dismissal, alias and keyboard insertion on the current autocomplete request', async () => {
  const { view } = createCommandView({ doc: '[[]]', selection: { anchor: 2 } });
  const controller = { view, runtime: null, sharedResources: null, paneKey: Symbol(), onBodyChange: () => {} } as unknown as EditorController;
  let state = createWikilinkAutocompleteState();
  const runtime = createWikilinkRuntime({ getState: () => state, setState: value => { state = value; }, getCurrentNoteId: () => 'note', getCurrentPath: () => '/note.md', getCurrentTitle: () => 'Note', getCurrentMarkdown: () => view.state.doc.toString(), getEditorController: () => controller, cancelPendingAutosave: vi.fn(), openNotePath: vi.fn(), getNavigationContext: () => ({ currentNoteId: 'note', currentNotePath: '/note.md', editorRoot: null, titleShell: null, focusTitleAtEnd: vi.fn() }), saveCursorPositionForNote: vi.fn() });
  const target = { rawTarget: '', targetFrom: 2, targetTo: 2, left: 0, top: 0, bottom: 0 };
  const suggestion = (value: string): NoteLinkSuggestion => ({ kind: 'note', value, label: value, detail: '' });
  let release!: (value: NoteLinkSuggestion[]) => void;
  invoke.mockReset(); invoke.mockReturnValueOnce(new Promise<NoteLinkSuggestion[]>(yes => { release = yes; })).mockResolvedValueOnce([suggestion('Current')]);
  const old = runtime.handleActiveWikilinkChange(target);
  await runtime.handleActiveWikilinkChange({ ...target, rawTarget: 'Current' });
  release([suggestion('Old')]); await old; expect(state.suggestions[0].value).toBe('Current');
  runtime.selectWikilinkSuggestion('Old'); expect(view.state.doc.toString()).toBe('[[]]');
  for (const [key, modifiers] of [['Enter', { ctrlKey: true }], ['ArrowDown', { altKey: true }], ['Escape', { shiftKey: true }]] as const) {
    const event = { key, ...modifiers, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(runtime.handleAutocompleteKeydown(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.active).toBe(true);
  }
  expect(runtime.handleAutocompleteKeydown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(true);
  expect(view.state.doc.toString()).toBe('[[Current]]'); expect(state.active).toBe(false);
  invoke.mockReturnValueOnce(new Promise<NoteLinkSuggestion[]>(yes => { release = yes; }));
  const pending = runtime.handleActiveWikilinkChange(target); runtime.closeWikilinkAutocomplete(); release([suggestion('Late')]); await pending;
  expect(state.active).toBe(false); expect(state.suggestions).toEqual([]);
  invoke.mockClear(); await runtime.handleActiveWikilinkChange({ ...target, rawTarget: 'Current|alias' }); expect(invoke).not.toHaveBeenCalled();
});

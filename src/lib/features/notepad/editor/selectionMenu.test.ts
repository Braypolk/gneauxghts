import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { createMarkdownLanguage } from '../markdown/markdownLanguage';
import { createCommandView } from './commandTestSupport';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import { createRuntimePane } from './testSupport';
import { setSelectionMenuListener } from './selectionMenuBridge';
import type { NativeSelectionMenuTarget } from './selectionMenuTarget';
import {
  createSelectionMenuPlugin,
  selectionMenuApplyInlineFromUi,
  selectionMenuClearNativeTarget,
  selectionMenuHandleKeydownFromUi,
  selectionMenuPickBlockFromUi,
  selectionMenuSetNativeTarget,
  selectionMenuToggleBlockPanelFromUi,
  type SelectionMenuSnapshot
} from './selectionMenu';

describe('native input selection formatting', () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    setSelectionMenuListener(null);
    vi.unstubAllGlobals();
  });

  function harness() {
    const plugin = createSelectionMenuPlugin();
    const table = '| Header |\n| --- |\n| hello world |';
    const { view, transactions } = createCommandView({
      doc: table,
      selection: { anchor: 0 },
      extensions: [createMarkdownLanguage(), history(), plugin.extension]
    });
    // Run the real selection-menu update listener after every command dispatch.
    // The command view retains actual CodeMirror transactions and undo history.
    const dispatch = view.dispatch.bind(view);
    view.dispatch = ((...specs: Parameters<typeof dispatch>) => {
      dispatch(...specs);
      for (const listener of view.state.facet(EditorView.updateListener)) {
        listener({ view } as ViewUpdate);
      }
    }) as EditorView['dispatch'];
    const snapshots: SelectionMenuSnapshot[] = [];
    setSelectionMenuListener((_view, snapshot) => snapshots.push(snapshot));
    plugin.register(view);
    cleanups.push(() => plugin.unregister(view));
    let valid = true;
    let canonical = view.state.doc;
    let range = { from: view.state.doc.toString().indexOf('hello'), to: view.state.doc.toString().indexOf('hello') + 5 };
    const restoreSelection = vi.fn((next: { from: number; to: number }) => {
      canonical = view.state.doc;
      range = { from: next.from, to: next.to };
    });
    const target: NativeSelectionMenuTarget = {
      read: () => valid && canonical === view.state.doc ? range : null,
      anchor: { getBoundingClientRect: vi.fn(), contextElement: {} as Element },
      restoreSelection
    };
    return { view, transactions, target, restoreSelection, snapshots,
      invalidate: () => { valid = false; }, latest: () => snapshots.at(-1) };
  }

  it('opens for a native range while CodeMirror has a collapsed selection and no focus', () => {
    const h = harness();
    expect(h.latest()).toEqual({ open: false });
    selectionMenuSetNativeTarget(h.view, h.target);
    expect(h.view.state.selection.main.empty).toBe(true);
    expect(h.latest()).toMatchObject({ open: true, nativeAnchor: h.target.anchor, blockPanelOpen: false });
  });

  it('formats canonical cell source without stealing focus, preserves native selection and shares undo', () => {
    const h = harness();
    const original = h.view.state.doc.toString();
    selectionMenuSetNativeTarget(h.view, h.target);
    selectionMenuApplyInlineFromUi(h.view, 'bold');
    expect(h.view.state.doc.toString()).toBe('| Header |\n| --- |\n| **hello** world |');
    expect(h.view.focus).not.toHaveBeenCalled();
    expect(h.restoreSelection).toHaveBeenCalledWith(h.view.state.selection.main);
    expect(h.latest()).toMatchObject({ open: true, activeInlineFormats: ['bold'], nativeAnchor: h.target.anchor });
    expect(h.transactions.filter(transaction => transaction.docChanged)).toHaveLength(1);
    expect(undo(h.view)).toBe(true);
    expect(h.view.state.doc.toString()).toBe(original);
  });

  it('ignores a retired source or input rather than formatting the stale CodeMirror range', () => {
    const h = harness();
    selectionMenuSetNativeTarget(h.view, h.target);
    h.invalidate();
    selectionMenuApplyInlineFromUi(h.view, 'bold');
    expect(h.transactions).toHaveLength(0);
    expect(h.latest()).toEqual({ open: false });
  });

  it('keeps table selection inline-only and identity-clears only its own native target', () => {
    const h = harness();
    selectionMenuSetNativeTarget(h.view, h.target);
    selectionMenuToggleBlockPanelFromUi(h.view);
    selectionMenuPickBlockFromUi(h.view, 0);
    expect(h.transactions).toHaveLength(0);
    expect(h.latest()).toMatchObject({ open: true, blockPanelOpen: false });
    selectionMenuClearNativeTarget(h.view, { ...h.target });
    expect(h.latest()).toMatchObject({ open: true });
    selectionMenuClearNativeTarget(h.view, h.target);
    expect(h.latest()).toEqual({ open: false });
  });

  it('ignores an action delivered after native selection dismissal', () => {
    const h = harness();
    selectionMenuSetNativeTarget(h.view, h.target);
    selectionMenuApplyInlineFromUi(h.view, 'bold');
    const formatted = h.view.state.doc.toString();
    selectionMenuClearNativeTarget(h.view, h.target);
    selectionMenuApplyInlineFromUi(h.view, 'italic');
    expect(h.view.state.doc.toString()).toBe(formatted);
    expect(h.view.focus).not.toHaveBeenCalled();
  });

  it('uses configured editor formatting shortcuts for the focused native selection', () => {
    const h = harness();
    selectionMenuSetNativeTarget(h.view, h.target);
    const event = {
      key: 'b', code: 'KeyB', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn()
    } as unknown as KeyboardEvent;
    selectionMenuHandleKeydownFromUi(h.view, event);
    expect(h.view.state.doc.toString()).toContain('**hello** world');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(h.view.focus).not.toHaveBeenCalled();
  });

  it('lets a native cell handle Escape after dismissing its popup', () => {
    const h = harness();
    selectionMenuSetNativeTarget(h.view, h.target);
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent;
    selectionMenuHandleKeydownFromUi(h.view, event);
    expect(h.latest()).toEqual({ open: false });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('continues consuming Escape when dismissing the source selection popup', () => {
    const h = harness();
    Object.defineProperty(h.view, 'hasFocus', { value: true });
    h.view.dispatch({ selection: { anchor: 2, head: 8 } });
    expect(h.latest()).toMatchObject({ open: true });
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent;
    selectionMenuHandleKeydownFromUi(h.view, event);
    expect(h.latest()).toEqual({ open: false });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('undoes native formatting separately from the table pasted immediately before it', () => {
    const plugin = createSelectionMenuPlugin();
    const runtime = new EditorDocumentRuntime('');
    const first = createRuntimePane(runtime, '', 0, undefined, [createMarkdownLanguage(), plugin.extension]);
    const sibling = createRuntimePane(runtime, '', 0, undefined, [createMarkdownLanguage()]);
    plugin.register(first.view);
    cleanups.push(() => { plugin.unregister(first.view); runtime.destroy(); });
    const pasted = '| Header |\n| --- |\n| hello world |';
    first.view.dispatch({ changes: { from: 0, insert: pasted }, userEvent: 'input.paste' });
    let range = { from: pasted.indexOf('hello'), to: pasted.indexOf('hello') + 5 };
    const target: NativeSelectionMenuTarget = {
      read: () => range,
      anchor: { getBoundingClientRect: vi.fn(), contextElement: {} as Element },
      restoreSelection(next) { range = { from: next.from, to: next.to }; }
    };
    selectionMenuSetNativeTarget(first.view, target);
    selectionMenuApplyInlineFromUi(first.view, 'bold');
    expect(runtime.markdown).toContain('**hello**');
    expect(sibling.readState().doc.toString()).toBe(runtime.markdown);
    expect(runtime.undo(sibling.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe(pasted);
    expect(first.readState().doc.toString()).toBe(pasted);
    expect(runtime.undo(first.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe('');
  });
});

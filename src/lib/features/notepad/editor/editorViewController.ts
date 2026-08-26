import { tick } from 'svelte';
import { Compartment, Transaction, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CursorPosition } from './editorViewState';
import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import { EditorDocumentRuntime } from './editorDocumentRuntime';
import {
  createPaneExtensions,
  createPaneState
} from './editorExtensions';
import { createMarkdownBaseExtensions } from './editorShortcuts';
import type {
  CreateEditorOptions,
  EditorController,
  EditorSelection,
  EditorSnapshot,
  EditorViewCallbacks,
  ReplaceEditorContentOptions,
  ReplaceEditorDocumentOptions,
  RestoreCursorPositionOptions,
  SharedEditorResources,
  SwapEditorRuntimeOptions
} from './types';

const defaultViewCallbacks: EditorViewCallbacks = {
  onOpenLink: () => {},
  onActiveWikilinkChange: () => {},
  onViewStateChange: () => {}
};

function readSelection(view: EditorView): EditorSelection {
  const selection = view.state.selection.main;
  return {
    anchor: selection.anchor,
    head: selection.head
  };
}

function clampPos(
  doc: EditorView['state']['doc'],
  pos: number | null | undefined
) {
  return Math.max(0, Math.min(pos ?? 0, doc.length));
}

function buildPaneBinding(
  getController: () => EditorController | null,
  editorRoot: HTMLDivElement,
  sharedResources: SharedEditorResources | null,
  markdown: string,
  selection: EditorSelection | null
) {
  const proposalReviewCompartment = new Compartment();
  const paneExtensions = createPaneExtensions(
    getController,
    editorRoot,
    sharedResources
  );
  const state = createPaneState(
    markdown,
    [
      ...createMarkdownBaseExtensions(),
      proposalReviewCompartment.of([]),
      ...paneExtensions.extensions
    ],
    selection
  );
  return {
    state,
    proposalReviewCompartment,
    slashMenuApi: paneExtensions.slashMenuApi,
    selectionMenuApi: paneExtensions.selectionMenuApi
  };
}

function bindController(
  controller: EditorController,
  runtime: EditorDocumentRuntime,
  sharedResources: SharedEditorResources | null,
  viewCallbacks: EditorViewCallbacks,
  onMarkdownChange: (markdown: string) => void,
  paneKey: symbol,
  proposalReviewCompartment: Compartment
) {
  controller.runtime = runtime;
  controller.sharedResources = sharedResources;
  controller.paneKey = paneKey;
  controller.onMarkdownChange = onMarkdownChange;
  controller.proposalReviewCompartment = proposalReviewCompartment;
  sharedResources?.registerViewCallbacks(controller.view, viewCallbacks);
  runtime.attachController(controller);
}

export async function prepareEditor(editorRoot: HTMLDivElement | null) {
  if (!editorRoot) return false;
  await tick();
  return !!editorRoot;
}

export async function createEditor({
  editorRoot,
  initialValue,
  onMarkdownChange,
  initialState = null,
  sharedResources = null,
  viewCallbacks = defaultViewCallbacks
}: CreateEditorOptions) {
  editorRoot.classList.add('gn-editor-root');

  const runtime =
    sharedResources?.runtime ??
    new EditorDocumentRuntime(initialState?.markdown ?? initialValue);
  runtime.ensureMarkdown(initialState?.markdown ?? initialValue);

  let controller: EditorController | null = null;
  const binding = buildPaneBinding(
    () => controller,
    editorRoot,
    sharedResources,
    initialState?.markdown ?? runtime.markdown,
    initialState?.selection ?? null
  );
  const view = new EditorView({
    state: binding.state,
    parent: editorRoot,
    dispatchTransactions: (transactions, viewInstance) => {
      if (!controller) {
        viewInstance.update(transactions);
        return;
      }
      controller.runtime.dispatchFromPane(controller, transactions);
    }
  });

  controller = {
    view,
    runtime,
    sharedResources,
    paneKey: Symbol('editor-pane'),
    onMarkdownChange,
    proposalReviewCompartment: binding.proposalReviewCompartment
  };
  bindController(
    controller,
    runtime,
    sharedResources,
    viewCallbacks,
    onMarkdownChange,
    controller.paneKey,
    binding.proposalReviewCompartment
  );
  binding.slashMenuApi.register(view);
  binding.selectionMenuApi.register(view);
  return controller;
}

export async function destroyEditor(controller: EditorController | null) {
  if (!controller) {
    return null;
  }

  controller.sharedResources?.unregisterViewCallbacks(controller.view);
  controller.runtime.detachController(controller);
  if (!controller.sharedResources) {
    controller.runtime.destroy();
  }
  controller.view.destroy();
  return null;
}

export function swapEditorRuntime(
  controller: EditorController | null,
  {
    sharedResources,
    initialValue,
    initialState = null,
    viewCallbacks,
    onMarkdownChange
  }: SwapEditorRuntimeOptions
): boolean {
  if (!controller) {
    return false;
  }

  const view = controller.view;
  const editorRoot = view.dom.parentElement;
  if (!(editorRoot instanceof HTMLDivElement)) {
    return false;
  }

  controller.sharedResources?.unregisterViewCallbacks(view);
  controller.runtime.detachController(controller);

  const nextRuntime = sharedResources.runtime;
  nextRuntime.ensureMarkdown(initialState?.markdown ?? initialValue);
  const binding = buildPaneBinding(
    () => controller,
    editorRoot,
    sharedResources,
    initialState?.markdown ?? nextRuntime.markdown,
    initialState?.selection ?? null
  );
  view.setState(binding.state);

  const paneKey = Symbol('editor-pane');
  bindController(
    controller,
    nextRuntime,
    sharedResources,
    viewCallbacks,
    onMarkdownChange,
    paneKey,
    binding.proposalReviewCompartment
  );
  binding.slashMenuApi.register(view);
  binding.selectionMenuApi.register(view);
  return true;
}

export function replaceEditorContent(
  controller: EditorController | null,
  markdown: string,
  { flushHistory = false }: ReplaceEditorContentOptions = {}
) {
  if (!controller) {
    return false;
  }

  controller.runtime.applyExternalSnapshot(
    {
      markdown,
      selection: readSelection(controller.view),
      revision: controller.runtime.revision + 1
    },
    controller,
    flushHistory
  );
  // A no-op replacement is still successfully handled. Lifecycle callers
  // use false specifically to detect an unavailable editor and fall back to
  // recreation.
  return true;
}

export function readEditorState(
  controller: EditorController | null
): EditorSnapshot | null {
  if (!controller) {
    return null;
  }

  return controller.runtime.snapshotFor(controller);
}

export function replaceEditorDocument(
  controller: EditorController | null,
  markdown: string | null,
  {
    anchor = null,
    head = null,
    focus = false,
    scrollSelectionIntoView = false
  }: ReplaceEditorDocumentOptions = {}
) {
  if (!controller || markdown == null) {
    return false;
  }

  const nextDocLength = markdown.length;
  const selection = {
    anchor: Math.max(
      0,
      Math.min(
        anchor ?? controller.view.state.selection.main.anchor,
        nextDocLength
      )
    ),
    head: Math.max(
      0,
      Math.min(
        head ?? controller.view.state.selection.main.head,
        nextDocLength
      )
    )
  };
  const runtime = controller.runtime;
  if (runtime.markdown === markdown) {
    controller.view.dispatch({
      selection,
      scrollIntoView: scrollSelectionIntoView,
      annotations: Transaction.addToHistory.of(false)
    });
    if (focus) controller.view.focus();
    return true;
  }
  const didReplace = runtime.applyExternalSnapshot(
    {
      markdown,
      selection,
      revision: runtime.revision + 1
    },
    controller,
    false
  );

  if (didReplace && scrollSelectionIntoView) {
    controller.view.dispatch({
      selection,
      scrollIntoView: true
    });
  }
  if (focus) {
    controller.view.focus();
  }
  return didReplace;
}

export function readCursorPosition(
  controller: EditorController | null
): CursorPosition | null {
  return controller ? readSelection(controller.view) : null;
}

export function restoreCursorPosition(
  controller: EditorController | null,
  position: CursorPosition | null,
  { scrollIntoView = true }: RestoreCursorPositionOptions = {}
) {
  if (!controller || !position) {
    return false;
  }

  const anchor = clampPos(controller.view.state.doc, position.anchor);
  const head = clampPos(controller.view.state.doc, position.head);
  controller.view.dispatch({
    selection: { anchor, head },
    ...(scrollIntoView ? { scrollIntoView: true } : {}),
    annotations: [Transaction.addToHistory.of(false)]
  });
  return true;
}

export function alignEditorScrollToSelection(
  controller: EditorController | null,
  fractionFromTop = 0.25
): boolean {
  if (!controller) {
    return false;
  }

  const view = controller.view;
  const scrollEl = view.scrollDOM;
  const coords = view.coordsAtPos(view.state.selection.main.head);
  if (!coords) {
    view.requestMeasure();
    return false;
  }

  const portRect = scrollEl.getBoundingClientRect();
  const cursorMidY = (coords.top + coords.bottom) / 2;
  const contentY =
    scrollEl.scrollTop + (cursorMidY - portRect.top);
  const targetScroll =
    contentY - fractionFromTop * scrollEl.clientHeight;
  const maxScroll = Math.max(
    0,
    scrollEl.scrollHeight - scrollEl.clientHeight
  );
  scrollEl.scrollTop = Math.max(0, Math.min(targetScroll, maxScroll));
  return true;
}

export function insertWikilinkSuggestion(
  controller: EditorController | null,
  activeWikilink: ActiveWikilink | null,
  suggestionValue: string
) {
  if (!controller || !activeWikilink) {
    return false;
  }

  controller.view.dispatch({
    changes: {
      from: activeWikilink.targetFrom,
      to: activeWikilink.targetTo,
      insert: suggestionValue
    },
    selection: {
      anchor: activeWikilink.targetFrom + suggestionValue.length
    }
  });
  controller.view.focus();
  return true;
}

export function setProposalReviewExtensions(
  controller: EditorController | null,
  extension: Extension | readonly Extension[] | null
) {
  if (!controller) return false;
  controller.view.dispatch({
    effects: controller.proposalReviewCompartment.reconfigure(extension ?? [])
  });
  return true;
}

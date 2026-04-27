import { isolateHistory, redo, undo } from '@codemirror/commands';
import {
  Annotation,
  EditorState,
  RangeSetBuilder,
  type Extension,
  StateEffect,
  StateField,
  Transaction
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet
} from '@codemirror/view';
import { draftly } from 'draftly/src/editor/draftly';
import { tick } from 'svelte';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  applyBlockTypeSelection,
  deleteCurrentBlock,
  describeBlockAt,
  getClipboardMarkdownForCurrentBlock,
  insertParagraphBelow,
  listBlocks,
  moveBlockTo,
  moveCurrentBlock,
  type BlockDescriptor
} from '$lib/features/notepad/editor/blockTypes';
import type { CursorPosition } from '$lib/features/notepad/editor/cursorState';
import { notepadDraftlyPlugins } from '$lib/features/notepad/editor/draftlyPlugins';
import { getEditorProseSurface } from '$lib/features/notepad/editor/editorDom';
import {
  createSlashMenuPlugin,
  setSlashMenuFloatingReference,
  type SlashMenuAPI
} from '$lib/features/notepad/editor/slashMenu';
import { mountBlockHandle } from '$lib/features/notepad/editor/blockHandleMount';
import { createImageEmbedsExtension } from '$lib/features/notepad/images/imageEmbeds';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';
import { createImagePasteExtension } from '$lib/features/notepad/images/imagePaste';
import type { StoredImageAsset } from '$lib/features/notepad/model/types';
import { createWikilinksExtension, type ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import { keyboardShortcutMatchesEvent, usesNativeCutShortcut } from '$lib/keyboardShortcuts';

interface CreateEditorOptions {
  editorRoot: HTMLDivElement;
  initialValue: string;
  onMarkdownChange: (markdown: string) => void;
  initialState?: EditorSnapshot | null;
  sharedResources?: SharedEditorResources | null;
  viewCallbacks?: EditorViewCallbacks;
}

interface ReplaceEditorContentOptions {
  flushHistory?: boolean;
}

interface ReplaceEditorStateOptions {
  focus?: boolean;
  scrollSelectionIntoView?: boolean;
}

interface ReplaceEditorDocumentOptions {
  anchor?: number | null;
  head?: number | null;
  focus?: boolean;
  scrollSelectionIntoView?: boolean;
}

export interface EditorSelection {
  anchor: number;
  head: number;
}

export interface EditorSnapshot {
  markdown: string;
  selection: EditorSelection;
  revision: number;
}

export interface EditorController {
  view: EditorView;
  sharedResources: SharedEditorResources | null;
  paneKey: symbol;
  onMarkdownChange: (markdown: string) => void;
}

export interface EditorViewCallbacks {
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
}

export interface SharedEditorResources {
  imagesConfig: ImagesConfig;
  registerViewCallbacks: (view: EditorView, callbacks: EditorViewCallbacks) => void;
  unregisterViewCallbacks: (view: EditorView) => void;
  setCurrentSearchHighlightQuery: (query: string | null) => void;
  resolveViewCallbacks?: (view: EditorView) => EditorViewCallbacks | null;
  runtime: FileEditorRuntime;
  destroy: () => void;
}

interface CreateSharedEditorResourcesOptions {
  assetRootPath: string | null;
  onTaskListToggle: () => void;
  onStorePastedImage: (file: File) => Promise<StoredImageAsset>;
}

interface RuntimeReplaceOptions {
  flushHistory?: boolean;
  selectionByPaneKey?: Map<symbol, EditorSelection>;
  preferredPaneKey?: symbol | null;
}

const syncAnnotation = Annotation.define<boolean>();
const setSearchQueryEffect = StateEffect.define<string>();
const searchQueryField = StateField.define<string>({
  create() {
    return '';
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchQueryEffect)) {
        return effect.value;
      }
    }
    return value;
  }
});

function clampPos(doc: EditorState['doc'], pos: number | null | undefined) {
  return Math.max(0, Math.min(pos ?? 0, doc.length));
}

function normalizeSearchQuery(query: string | null | undefined) {
  return query?.trim().toLowerCase() ?? '';
}

function buildSearchHighlightDecorations(state: EditorState, query: string) {
  if (query === '') {
    return Decoration.none;
  }

  const decorations = [];
  const text = state.doc.toString().toLowerCase();
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const matchStart = text.indexOf(query, searchFrom);
    if (matchStart === -1) {
      break;
    }

    decorations.push(
      Decoration.mark({ class: 'gn-current-search-highlight' }).range(
        matchStart,
        matchStart + query.length
      )
    );
    searchFrom = matchStart + query.length;
  }

  return Decoration.set(decorations, true);
}

function createSearchHighlightExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations;

      constructor(readonly view: EditorView) {
        this.decorations = buildSearchHighlightDecorations(
          view.state,
          view.state.field(searchQueryField)
        );
      }

      update(update: import('@codemirror/view').ViewUpdate) {
        if (update.docChanged || update.startState.field(searchQueryField) !== update.state.field(searchQueryField)) {
          this.decorations = buildSearchHighlightDecorations(
            update.state,
            update.state.field(searchQueryField)
          );
        }
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function readSelection(view: EditorView): EditorSelection {
  const selection = view.state.selection.main;
  return {
    anchor: selection.anchor,
    head: selection.head
  };
}

function createRootState(markdown: string) {
  return EditorState.create({
    doc: markdown,
    extensions: [
      draftly({
        baseStyles: false,
        defaultKeybindings: false,
        history: true,
        lineWrapping: true,
        plugins: notepadDraftlyPlugins
      })
    ]
  });
}

function createPaneState(
  markdown: string,
  extensions: readonly Extension[],
  initialSelection: EditorSelection | null = null
) {
  return EditorState.create({
    doc: markdown,
    selection: initialSelection
      ? {
          anchor: Math.max(0, initialSelection.anchor),
          head: Math.max(0, initialSelection.head)
        }
      : undefined,
    extensions
  });
}

const unavailableImagesConfig: ImagesConfig = {
  assetRootPath: null,
  storePastedImage: async () => {
    throw new Error('Image pasting unavailable for this editor instance.');
  }
};

class FileEditorRuntime {
  readonly rootView: EditorView;
  readonly paneControllers = new Map<symbol, EditorController>();
  revision = 0;

  constructor(initialMarkdown = '') {
    this.rootView = new EditorView({
      state: createRootState(initialMarkdown),
      dispatchTransactions: (transactions, view) => {
        this.applyRootTransactions(view, transactions, null);
      }
    });
  }

  get markdown() {
    return this.rootView.state.doc.toString();
  }

  attachController(controller: EditorController) {
    this.paneControllers.set(controller.paneKey, controller);
  }

  detachController(controller: EditorController) {
    this.paneControllers.delete(controller.paneKey);
  }

  destroy() {
    this.rootView.destroy();
    this.paneControllers.clear();
  }

  ensureMarkdown(markdown: string) {
    if (this.paneControllers.size > 0 || this.markdown === markdown) {
      return;
    }
    this.replaceMarkdown(markdown, { flushHistory: true });
  }

  dispatchFromPane(controller: EditorController, transactions: readonly Transaction[]) {
    controller.view.update(transactions);

    const docChangedTransactions = transactions.filter(
      (transaction) => transaction.docChanged && !transaction.annotation(syncAnnotation)
    );
    if (docChangedTransactions.length === 0) {
      return;
    }

    for (const transaction of docChangedTransactions) {
      const spec = {
        changes: transaction.changes,
        annotations: collectHistoryAnnotations(transaction)
      };
      this.rootView.update([this.rootView.state.update(spec)]);
    }

    this.revision += 1;
    this.broadcastTransactions(docChangedTransactions, controller.paneKey);
    this.notifyMarkdownChange(controller.paneKey);
  }

  applyRootTransactions(
    view: EditorView,
    transactions: readonly Transaction[],
    preferredPaneKey: symbol | null
  ) {
    view.update(transactions);
    const docChangedTransactions = transactions.filter((transaction) => transaction.docChanged);
    if (docChangedTransactions.length === 0) {
      return;
    }

    this.revision += 1;
    this.broadcastTransactions(docChangedTransactions, null);
    this.notifyMarkdownChange(preferredPaneKey);
  }

  replaceMarkdown(markdown: string, options: RuntimeReplaceOptions = {}) {
    if (!options.flushHistory && this.markdown === markdown) {
      return false;
    }

    const selectionByPaneKey = options.selectionByPaneKey ?? new Map<symbol, EditorSelection>();
    if (options.flushHistory) {
      this.rootView.setState(createRootState(markdown));
    } else {
      this.rootView.update([
        this.rootView.state.update({
          changes: { from: 0, to: this.rootView.state.doc.length, insert: markdown },
          annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full')]
        })
      ]);
    }

    for (const [paneKey, controller] of this.paneControllers) {
      const selection = selectionByPaneKey.get(paneKey) ?? readSelection(controller.view);
      controller.view.dispatch(
        controller.view.state.update({
          changes: { from: 0, to: controller.view.state.doc.length, insert: markdown },
          selection,
          annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false), isolateHistory.of('full')]
        })
      );
    }

    this.revision += 1;
    this.notifyMarkdownChange(options.preferredPaneKey ?? null);
    return true;
  }

  applyExternalSnapshot(snapshot: EditorSnapshot, controller: EditorController | null, flushHistory = false) {
    const selectionByPaneKey = new Map<symbol, EditorSelection>();
    for (const [paneKey, paneController] of this.paneControllers) {
      if (controller && paneKey === controller.paneKey) {
        selectionByPaneKey.set(paneKey, snapshot.selection);
      } else {
        selectionByPaneKey.set(paneKey, readSelection(paneController.view));
      }
    }

    return this.replaceMarkdown(snapshot.markdown, {
      flushHistory,
      selectionByPaneKey,
      preferredPaneKey: controller?.paneKey ?? null
    });
  }

  undo(preferredPaneKey: symbol | null) {
    return undo({
      state: this.rootView.state,
      dispatch: (transaction) => this.applyRootTransactions(this.rootView, [transaction], preferredPaneKey)
    });
  }

  redo(preferredPaneKey: symbol | null) {
    return redo({
      state: this.rootView.state,
      dispatch: (transaction) => this.applyRootTransactions(this.rootView, [transaction], preferredPaneKey)
    });
  }

  snapshotFor(controller: EditorController): EditorSnapshot {
    return {
      markdown: this.markdown,
      selection: readSelection(controller.view),
      revision: this.revision
    };
  }

  private broadcastTransactions(transactions: readonly Transaction[], sourcePaneKey: symbol | null) {
    for (const [paneKey, controller] of this.paneControllers) {
      if (sourcePaneKey && paneKey === sourcePaneKey) {
        continue;
      }

      const updates = transactions.map((transaction) =>
        controller.view.state.update({
          changes: transaction.changes,
          annotations: [syncAnnotation.of(true), Transaction.addToHistory.of(false)]
        })
      );
      controller.view.update(updates);
    }
  }

  private notifyMarkdownChange(preferredPaneKey: symbol | null) {
    const preferredController = preferredPaneKey ? this.paneControllers.get(preferredPaneKey) : null;
    const controller = preferredController ?? this.paneControllers.values().next().value ?? null;
    controller?.onMarkdownChange(this.markdown);
  }
}

function collectHistoryAnnotations(transaction: Transaction) {
  const annotations = [];
  const userEvent = transaction.annotation(Transaction.userEvent);
  if (userEvent) {
    annotations.push(Transaction.userEvent.of(userEvent));
  }
  const historyBoundary = transaction.annotation(isolateHistory);
  if (historyBoundary) {
    annotations.push(isolateHistory.of(historyBoundary));
  }
  return annotations;
}

function createLayoutTheme() {
  return EditorView.theme({
    '&.cm-editor.cm-draftly': {
      height: '100%',
      minHeight: '100%',
      border: 'none',
      outline: 'none',
      background: 'transparent'
    },
    '&.cm-editor.cm-draftly.cm-focused': {
      outline: 'none'
    },
    '&.cm-editor.cm-draftly .cm-cursor, &.cm-editor.cm-draftly .cm-dropCursor': {
      borderLeftColor: 'var(--foreground) !important'
    },
    '&.cm-editor.cm-draftly .cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: '1.75'
    },
    '&.cm-editor.cm-draftly .cm-content': {
      boxSizing: 'border-box',
      minHeight: '100%',
      maxWidth: '100%',
      width: 'min(100%, calc(var(--editor-readable-width) + var(--editor-left-padding) + var(--editor-handle-lane-width) + var(--editor-right-padding)))',
      margin: '0 auto',
      paddingTop: 'var(--editor-top-padding)',
      paddingLeft: 'calc(var(--editor-left-padding) + var(--editor-handle-lane-width))',
      paddingRight: 'var(--editor-right-padding)',
      paddingBottom: 'var(--editor-bottom-padding)',
      color: 'var(--foreground)',
      caretColor: 'var(--foreground)',
      overflowAnchor: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    },
    '&.cm-editor.cm-draftly .cm-selectionBackground': {
      backgroundColor: 'var(--gn-editor-selection-background) !important'
    },
    '&.cm-editor.cm-draftly .cm-line': {
      paddingInline: 0
    },
    '&.cm-editor.cm-draftly .gn-markdown-table-line': {
      fontFamily: 'var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      fontSize: '0.92em',
      lineHeight: '1.7',
      color: 'var(--foreground)',
      backgroundColor: 'color-mix(in oklab, var(--card) 76%, var(--background))',
      boxShadow: 'inset 0 -1px 0 color-mix(in oklab, var(--border) 72%, transparent)',
      overflowX: 'auto',
      whiteSpace: 'pre'
    },
    '&.cm-editor.cm-draftly .gn-markdown-table-header': {
      fontWeight: '650',
      color: 'var(--foreground)',
      backgroundColor: 'color-mix(in oklab, var(--card) 88%, var(--foreground) 4%)',
      boxShadow:
        'inset 0 1px 0 color-mix(in oklab, var(--border) 76%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--border) 82%, transparent)'
    },
    '&.cm-editor.cm-draftly .gn-markdown-table-delimiter': {
      color: 'var(--muted-foreground)',
      backgroundColor: 'color-mix(in oklab, var(--muted) 28%, var(--background))'
    }
  });
}

function isMarkdownTableLine(text: string) {
  const trimmed = text.trim();
  return trimmed.includes('|') && trimmed !== '|';
}

function isMarkdownTableDelimiterLine(text: string) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(text);
}

function buildPassiveTableDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const delimiterLine = doc.line(lineNumber);
    if (!isMarkdownTableDelimiterLine(delimiterLine.text)) {
      continue;
    }

    const headerLine = doc.line(lineNumber - 1);
    if (!isMarkdownTableLine(headerLine.text)) {
      continue;
    }

    builder.add(
      headerLine.from,
      headerLine.from,
      Decoration.line({ class: 'gn-markdown-table-line gn-markdown-table-header' })
    );
    builder.add(
      delimiterLine.from,
      delimiterLine.from,
      Decoration.line({ class: 'gn-markdown-table-line gn-markdown-table-delimiter' })
    );

    let bodyLineNumber = lineNumber + 1;
    while (bodyLineNumber <= doc.lines) {
      const bodyLine = doc.line(bodyLineNumber);
      if (!isMarkdownTableLine(bodyLine.text)) {
        break;
      }

      builder.add(
        bodyLine.from,
        bodyLine.from,
        Decoration.line({ class: 'gn-markdown-table-line' })
      );
      bodyLineNumber += 1;
    }

    lineNumber = bodyLineNumber - 1;
  }

  return builder.finish();
}

function createPassiveTableExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildPassiveTableDecorations(view);
      }

      update(update: import('@codemirror/view').ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildPassiveTableDecorations(update.view);
        }
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function createEditorShortcuts(controller: () => EditorController | null) {
  return EditorView.domEventHandlers({
    keydown: (event, view) => {
      const current = controller();
      const runtime = current?.sharedResources?.runtime ?? null;

      if (keyboardShortcutMatchesEvent(event, 'editorUndo')) {
        event.preventDefault();
        return runtime ? runtime.undo(current?.paneKey ?? null) : undo(view);
      }

      if (
        keyboardShortcutMatchesEvent(event, 'editorRedo') ||
        keyboardShortcutMatchesEvent(event, 'editorRedoAlternate')
      ) {
        event.preventDefault();
        return runtime ? runtime.redo(current?.paneKey ?? null) : redo(view);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorInsertBelow')) {
        event.preventDefault();
        return insertParagraphBelow(view);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorMoveLineUp')) {
        event.preventDefault();
        return moveCurrentBlock(view, -1);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorMoveLineDown')) {
        event.preventDefault();
        return moveCurrentBlock(view, 1);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorCutLine')) {
        if (usesNativeCutShortcut('editorCutLine') || !view.state.selection.main.empty) {
          return false;
        }

        const markdown = getClipboardMarkdownForCurrentBlock(view);
        if (!markdown) {
          return false;
        }

        event.preventDefault();
        void navigator.clipboard
          .writeText(markdown)
          .then(() => {
            deleteCurrentBlock(view);
          })
          .catch((error) => {
            console.error('Failed to copy block markdown to clipboard:', error);
          });
        return true;
      }

      if (keyboardShortcutMatchesEvent(event, 'editorHardBreak')) {
        event.preventDefault();
        const selection = view.state.selection.main;
        view.dispatch(
          view.state.update({
            changes: { from: selection.from, to: selection.to, insert: '\n' },
            selection: { anchor: selection.from + 1 }
          })
        );
        return true;
      }

      if (keyboardShortcutMatchesEvent(event, 'editorIndentList')) {
        event.preventDefault();
        return adjustListIndent(view, 2);
      }

      if (keyboardShortcutMatchesEvent(event, 'editorOutdentList')) {
        event.preventDefault();
        return adjustListIndent(view, -2);
      }

      return false;
    }
  });
}

function adjustListIndent(view: EditorView, amount: number) {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from).number;
  const endLine = view.state.doc.lineAt(selection.to).number;
  const changes = [];

  for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
    const line = view.state.doc.line(lineNo);
    if (!/^(\s*)(?:[-+*]|\d+\.)\s+/.test(line.text)) {
      continue;
    }

    if (amount > 0) {
      changes.push({ from: line.from, to: line.from, insert: ' '.repeat(amount) });
    } else {
      const removable = Math.min(Math.abs(amount), line.text.match(/^\s*/)?.[0]?.length ?? 0);
      if (removable > 0) {
        changes.push({ from: line.from, to: line.from + removable, insert: '' });
      }
    }
  }

  if (changes.length === 0) {
    return false;
  }

  view.dispatch(view.state.update({ changes }));
  return true;
}

function createWikilinkExtensions(sharedResources: SharedEditorResources | null) {
  return createWikilinksExtension({
    resolveCallbacks: (view) => sharedResources?.resolveViewCallbacks?.(view) ?? null
  });
}

function findRenderedMarkdownLinkUrl(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement || target instanceof Text)) {
    return null;
  }

  const element = target instanceof Text ? target.parentElement : target;
  const linkElement =
    element?.closest<HTMLElement>('.cm-draftly-link-styled, .cm-draftly-link-wrapper') ?? null;
  const rawUrl = linkElement?.querySelector<HTMLElement>('.cm-draftly-link-tooltip')?.textContent;
  const url = rawUrl?.trim();

  return url || null;
}

function normalizeExternalLinkUrl(rawUrl: string): string | null {
  if (/^https?:\/\//i.test(rawUrl) || /^mailto:/i.test(rawUrl)) {
    return rawUrl;
  }

  if (/^www\./i.test(rawUrl)) {
    return `https://${rawUrl}`;
  }

  return null;
}

async function openExternalLink(rawUrl: string) {
  const url = normalizeExternalLinkUrl(rawUrl);
  if (!url) {
    return;
  }

  try {
    await openUrl(url);
  } catch (error) {
    console.error('Failed to open external link:', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function createExternalLinkClickExtension() {
  return ViewPlugin.fromClass(
    class {
      readonly #view: EditorView;

      constructor(view: EditorView) {
        this.#view = view;
        this.#view.dom.addEventListener('click', this.#handleClick, { capture: true });
      }

      destroy() {
        this.#view.dom.removeEventListener('click', this.#handleClick, { capture: true });
      }

      #handleClick = (event: MouseEvent) => {
        if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) {
          return;
        }

        const rawUrl = findRenderedMarkdownLinkUrl(event.target);
        if (!rawUrl || !normalizeExternalLinkUrl(rawUrl)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        void openExternalLink(rawUrl);
      };
    }
  );
}

interface VisualLineAnchor {
  block: BlockDescriptor;
  from: number;
  to: number;
  lineNumber: number;
  docTop: number;
  docBottom: number;
  centerDocY: number;
  isBlank: boolean;
}

interface HandleLaneMetrics {
  rootTop: number;
  left: number;
  textLeft: number;
  paddingLeft: number;
  surfaceWidth: number;
  handleHeight: number;
}

interface DropSlot {
  target: BlockDescriptor;
  before: boolean;
  indicatorDocY: number;
}

function createBlockHandleExtension(
  editorRoot: HTMLDivElement,
  showSlashMenu: (view: EditorView, pos: number) => void
) {
  return ViewPlugin.fromClass(
    class {
      readonly #view: EditorView;
      readonly #editorRoot: HTMLDivElement;
      readonly #scrollRoot: HTMLElement | null;
      readonly #dropIndicator: HTMLDivElement;
      readonly #unmountBlockHandle: () => void;
      #destroyed = false;
      #measureQueued = false;
      #hoveringHandle = false;
      #content: HTMLDivElement | null = null;
      #addButton: HTMLButtonElement | null = null;
      #dragButton: HTMLButtonElement | null = null;
      #currentBlock: BlockDescriptor | null = null;
      #pendingAnchor: VisualLineAnchor | null = null;
      #laneMetrics: HandleLaneMetrics | null = null;
      #laneDirty = true;
      #dropSlots: DropSlot[] | null = null;
      #dropSlotsDirty = true;
      #pointerX = 0;
      #pointerY = 0;
      #drag:
        | {
            pointerId: number;
            startX: number;
            startY: number;
            source: BlockDescriptor;
            before: boolean;
            target: BlockDescriptor | null;
            dragging: boolean;
            indicatorDocY: number | null;
          }
        | null = null;

      constructor(view: EditorView) {
        this.#view = view;
        this.#editorRoot = editorRoot;
        this.#scrollRoot = this.#editorRoot.closest<HTMLElement>('.notepad-editor-shell');
        this.#dropIndicator = document.createElement('div');
        this.#dropIndicator.className = 'notepad-block-drop-indicator';
        this.#dropIndicator.dataset.show = 'false';
        this.#dropIndicator.style.position = 'fixed';
        this.#editorRoot.appendChild(this.#dropIndicator);

        this.#unmountBlockHandle = mountBlockHandle(this.#editorRoot, (refs) => {
          this.#content = refs.content;
          this.#addButton = refs.addButton;
          this.#dragButton = refs.dragButton;
          refs.addButton.style.display = 'none';

          refs.content.addEventListener('pointerenter', this.handleHandlePointerEnter);
          refs.content.addEventListener('pointerleave', this.handleHandlePointerLeave);
          refs.addButton.addEventListener('click', this.handleAddClick);
          refs.dragButton.addEventListener('pointerdown', this.handleDragPointerDown);
        });

        this.#editorRoot.addEventListener('mousemove', this.handleMouseMove, true);
        this.#editorRoot.addEventListener('mouseleave', this.handleMouseLeave, true);
        this.#scrollRoot?.addEventListener('scroll', this.handleScroll, true);
      }

      update(update: import('@codemirror/view').ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.#laneDirty = true;
          this.#dropSlotsDirty = true;
        }
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.scheduleCurrentBlockSync();
        }
      }

      destroy() {
        this.#destroyed = true;
        this.#editorRoot.removeEventListener('mousemove', this.handleMouseMove, true);
        this.#editorRoot.removeEventListener('mouseleave', this.handleMouseLeave, true);
        this.#scrollRoot?.removeEventListener('scroll', this.handleScroll, true);
        window.removeEventListener('pointermove', this.handleWindowPointerMove, true);
        window.removeEventListener('pointerup', this.handleWindowPointerUp, true);
        window.removeEventListener('pointercancel', this.handleWindowPointerUp, true);
        this.#dropIndicator.remove();
        this.#content?.removeEventListener('pointerenter', this.handleHandlePointerEnter);
        this.#content?.removeEventListener('pointerleave', this.handleHandlePointerLeave);
        this.#unmountBlockHandle();
      }

      private handleMouseMove = (event: MouseEvent) => {
        this.#pointerX = event.clientX;
        this.#pointerY = event.clientY;
        if (this.#drag?.dragging) {
          return;
        }

        const anchor = this.resolveAnchorAtClientY(event.clientY);
        if (!anchor) {
          this.hideHandle();
          return;
        }

        if (
          this.#currentBlock &&
          this.#currentBlock.from === anchor.block.from &&
          this.#currentBlock.to === anchor.block.to &&
          this.#content?.dataset.show === 'true' &&
          !this.#laneDirty
        ) {
          return;
        }

        this.#pendingAnchor = anchor;
        this.scheduleCurrentBlockSync();
      };

      private handleMouseLeave = (event: MouseEvent) => {
        if (!this.#drag?.dragging) {
          const relatedTarget = event.relatedTarget;
          if (relatedTarget instanceof Node && this.#content?.contains(relatedTarget)) {
            return;
          }
          if (this.#hoveringHandle) {
            return;
          }
          this.hideHandle();
        }
      };

      private handleHandlePointerEnter = () => {
        this.#hoveringHandle = true;
      };

      private handleHandlePointerLeave = (event: PointerEvent) => {
        this.#hoveringHandle = false;
        if (this.#drag?.dragging) {
          return;
        }

        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && this.#editorRoot.contains(relatedTarget)) {
          return;
        }

        this.hideHandle();
      };

      private handleScroll = () => {
        this.#laneDirty = true;
        if (this.#currentBlock) {
          this.syncCurrentBlock();
        }
        if (this.#drag?.dragging) {
          this.renderDropIndicator();
        }
      };

      private handleAddClick = () => {
        if (!this.#currentBlock) {
          return;
        }
        insertParagraphBelow(this.#view, this.#currentBlock);
      };

      private handleDragPointerDown = (event: PointerEvent) => {
        if (!this.#currentBlock || !this.#dragButton) {
          return;
        }

        event.preventDefault();
        this.#drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          source: this.#currentBlock,
          before: true,
          target: null,
          dragging: false,
          indicatorDocY: null
        };
        this.#dropSlotsDirty = true;
        window.addEventListener('pointermove', this.handleWindowPointerMove, true);
        window.addEventListener('pointerup', this.handleWindowPointerUp, true);
        window.addEventListener('pointercancel', this.handleWindowPointerUp, true);
      };

      private handleWindowPointerMove = (event: PointerEvent) => {
        const drag = this.#drag;
        if (!drag || event.pointerId !== drag.pointerId) {
          return;
        }

        const movedEnough =
          Math.abs(event.clientX - drag.startX) > 5 || Math.abs(event.clientY - drag.startY) > 5;
        if (!drag.dragging && !movedEnough) {
          return;
        }

        drag.dragging = true;
        this.#content?.setAttribute('data-dragging', 'true');
        const slot = this.resolveDropSlot(event.clientY);
        if (!slot) {
          this.hideDropIndicator();
          return;
        }

        drag.target = slot.target;
        drag.before = slot.before;
        drag.indicatorDocY = slot.indicatorDocY;
        this.renderDropIndicator();
      };

      private handleWindowPointerUp = (event: PointerEvent) => {
        const drag = this.#drag;
        if (!drag || event.pointerId !== drag.pointerId) {
          return;
        }

        window.removeEventListener('pointermove', this.handleWindowPointerMove, true);
        window.removeEventListener('pointerup', this.handleWindowPointerUp, true);
        window.removeEventListener('pointercancel', this.handleWindowPointerUp, true);

        this.#content?.setAttribute('data-dragging', 'false');
        this.hideDropIndicator();

        if (!drag.dragging) {
          if (!this.selectionIncludesBlock(drag.source)) {
            this.focusBlock(drag.source);
          }
          if (this.#dragButton) {
            setSlashMenuFloatingReference(this.#view, this.#dragButton);
          }
          showSlashMenu(this.#view, drag.source.from);
          this.#drag = null;
          return;
        }

        if (
          drag.target &&
          (drag.target.from !== drag.source.from || drag.target.to !== drag.source.to)
        ) {
          moveBlockTo(this.#view, drag.source, drag.target, drag.before);
        }

        this.#drag = null;
      };

      private focusBlock(block: BlockDescriptor) {
        this.#view.dispatch(
          this.#view.state.update({
            selection: { anchor: block.from, head: block.from },
            scrollIntoView: true,
            annotations: [isolateHistory.of('full')]
          })
        );
        this.#view.focus();
      }

      private selectionIncludesBlock(block: BlockDescriptor) {
        const selection = this.#view.state.selection.main;
        return !selection.empty && selection.from <= block.to && selection.to >= block.from;
      }

      private scheduleCurrentBlockSync() {
        if (this.#measureQueued || this.#destroyed) {
          return;
        }

        this.#measureQueued = true;
        this.#view.requestMeasure({
          read: () => {
            const anchor =
              this.#pendingAnchor ??
              (this.#currentBlock ? this.resolveAnchorAtClientY(this.#pointerY) : null);
            if (!anchor) {
              return null;
            }

            const placement = this.measureHandlePlacement(anchor, this.readHandleLaneMetrics());
            if (!placement) {
              return null;
            }

            return { anchor, ...placement };
          },
          write: (measurement) => {
            this.#measureQueued = false;
            if (this.#destroyed || !measurement) {
              return;
            }

            this.#pendingAnchor = null;
            this.#currentBlock = measurement.anchor.block;
            this.renderMeasuredHandle(
              measurement.left,
              measurement.top,
              measurement.anchor.block.from
            );
          }
        });
      }

      private syncCurrentBlock() {
        if (!this.#currentBlock) {
          return;
        }
        const anchor = this.resolveAnchorAtClientY(this.#pointerY);
        if (!anchor) {
          return;
        }

        this.#pendingAnchor = anchor;
        this.scheduleCurrentBlockSync();
      }

      private renderMeasuredHandle(left: number, top: number, blockPos: number) {
        if (!this.#content) {
          return;
        }
        this.#content.dataset.show = 'true';
        this.#content.dataset.blockPos = String(blockPos);
        this.#content.style.left = `${left}px`;
        this.#content.style.top = `${top}px`;
      }

      private renderHandle(anchor: VisualLineAnchor) {
        this.#pendingAnchor = anchor;
        this.scheduleCurrentBlockSync();
      }

      private measureHandlePlacement(anchor: VisualLineAnchor, lane: HandleLaneMetrics | null) {
        if (!lane) {
          return null;
        }

        return {
          left: Math.round(lane.left),
          top: Math.round(this.#view.documentTop + anchor.centerDocY - lane.rootTop - lane.handleHeight / 2)
        };
      }

      private hideHandle() {
        if (!this.#content) {
          return;
        }
        this.#currentBlock = null;
        this.#content.dataset.show = 'false';
      }

      private renderDropIndicator() {
        const drag = this.#drag;
        if (!drag?.target || drag.indicatorDocY == null) {
          this.hideDropIndicator();
          return;
        }

        const lane = this.#laneDirty ? this.readHandleLaneMetrics() : this.#laneMetrics;
        if (!lane) {
          this.hideDropIndicator();
          return;
        }
        this.#dropIndicator.dataset.show = 'true';
        this.#dropIndicator.style.left = `${Math.round(lane.textLeft + 4)}px`;
        this.#dropIndicator.style.top = `${Math.round(this.#view.documentTop + drag.indicatorDocY - 1)}px`;
        this.#dropIndicator.style.width = `${Math.max(120, Math.round(lane.surfaceWidth - lane.paddingLeft - 8))}px`;
      }

      private resolveDropSlot(pointerY: number) {
        const slots = this.getDropSlots();
        if (slots.length === 0) {
          return null;
        }
        const pointerDocY = pointerY - this.#view.documentTop;
        return slots.reduce((best, slot) =>
          Math.abs(slot.indicatorDocY - pointerDocY) < Math.abs(best.indicatorDocY - pointerDocY)
            ? slot
            : best
        );
      }

      private resolveAnchorAtClientY(clientY: number) {
        const pointerDocY = clientY - this.#view.documentTop;
        const lineBlock = this.#view.lineBlockAtHeight(pointerDocY);
        if (pointerDocY < lineBlock.top || pointerDocY > lineBlock.top + lineBlock.height) {
          return null;
        }

        const block = describeBlockAt(this.#view.state, lineBlock.from);
        return block ? this.resolveAnchorForBlock(block) : null;
      }

      private resolveAnchorForBlock(block: BlockDescriptor) {
        const lineBlock = this.#view.lineBlockAt(block.from);
        if (!lineBlock) {
          return null;
        }

        return {
          block,
          from: block.from,
          to: block.to,
          lineNumber: block.startLine,
          docTop: lineBlock.top,
          docBottom: lineBlock.top + lineBlock.height,
          centerDocY: lineBlock.top + lineBlock.height / 2,
          isBlank: this.#view.state.doc.line(block.startLine).text.trim() === ''
        };
      }

      private readHandleLaneMetrics() {
        if (!this.#content) {
          return null;
        }

        if (this.#laneMetrics && !this.#laneDirty) {
          return this.#laneMetrics;
        }

        const surface = getEditorProseSurface(this.#view);
        const surfaceRect = surface.getBoundingClientRect();
        const rootRect = this.#editorRoot.getBoundingClientRect();
        const styles = getComputedStyle(surface);
        const paddingLeft = Number.parseFloat(styles.paddingLeft || '0') || 0;
        const nextMetrics = {
          rootTop: rootRect.top,
          left: surfaceRect.left - rootRect.left + 8,
          textLeft: surfaceRect.left + paddingLeft,
          paddingLeft,
          surfaceWidth: surfaceRect.width,
          handleHeight: Math.max(30, this.#content.getBoundingClientRect().height)
        } satisfies HandleLaneMetrics;
        this.#laneMetrics = nextMetrics;
        this.#laneDirty = false;
        return nextMetrics;
      }

      private getDropSlots() {
        if (this.#dropSlots && !this.#dropSlotsDirty) {
          return this.#dropSlots;
        }

        const blocks = listBlocks(this.#view.state);
        if (blocks.length === 0) {
          this.#dropSlots = [];
          this.#dropSlotsDirty = false;
          return this.#dropSlots;
        }

        const anchors = blocks
          .map((block) => this.resolveAnchorForBlock(block))
          .filter((entry): entry is VisualLineAnchor => entry !== null);

        if (anchors.length === 0) {
          this.#dropSlots = [];
          this.#dropSlotsDirty = false;
          return this.#dropSlots;
        }

        const slots: DropSlot[] = [
          {
            target: anchors[0].block,
            before: true,
            indicatorDocY: anchors[0].docTop
          }
        ];

        for (let index = 1; index < anchors.length; index += 1) {
          const previous = anchors[index - 1];
          const current = anchors[index];
          slots.push({
            target: current.block,
            before: true,
            indicatorDocY: (previous.docBottom + current.docTop) / 2
          });
        }

        const last = anchors[anchors.length - 1];
        slots.push({
          target: last.block,
          before: false,
          indicatorDocY: last.docBottom
        });

        this.#dropSlots = slots;
        this.#dropSlotsDirty = false;
        return slots;
      }

      private hideDropIndicator() {
        this.#dropIndicator.dataset.show = 'false';
      }
    }
  );
}

function createPaneExtensions(
  controller: () => EditorController | null,
  editorRoot: HTMLDivElement,
  sharedResources: SharedEditorResources | null,
  slashMenuApi: ReturnType<typeof createSlashMenuPlugin>
) {
  const imagesConfig = sharedResources?.imagesConfig ?? unavailableImagesConfig;
  return [
    searchQueryField,
    createLayoutTheme(),
    createSearchHighlightExtension(),
    createPassiveTableExtension(),
    ...createWikilinkExtensions(sharedResources),
    createExternalLinkClickExtension(),
    createImageEmbedsExtension(imagesConfig),
    ...createImagePasteExtension(imagesConfig),
    ...slashMenuApi.extension,
    createBlockHandleExtension(editorRoot, slashMenuApi.show),
    createEditorShortcuts(controller),
    EditorView.domEventHandlers({
      focus: (_event, view) => {
        slashMenuApi.register(view);
        return false;
      }
    }),
    keymap.of([])
  ];
}

export function createSharedEditorResources({
  assetRootPath,
  onTaskListToggle: _onTaskListToggle,
  onStorePastedImage
}: CreateSharedEditorResourcesOptions): SharedEditorResources {
  const viewCallbacks = new WeakMap<EditorView, EditorViewCallbacks>();
  const runtime = new FileEditorRuntime('');

  const sharedResources: SharedEditorResources & {
    resolveViewCallbacks: (view: EditorView) => EditorViewCallbacks | null;
  } = {
    imagesConfig: {
      assetRootPath,
      storePastedImage: onStorePastedImage
    },
    registerViewCallbacks: (view, callbacks) => {
      viewCallbacks.set(view, callbacks);
    },
    unregisterViewCallbacks: (view) => {
      viewCallbacks.delete(view);
    },
    resolveViewCallbacks: (view) => viewCallbacks.get(view) ?? null,
    setCurrentSearchHighlightQuery: (_query) => {},
    runtime,
    destroy: () => {
      runtime.destroy();
    }
  };

  return sharedResources;
}

export function setEditorCurrentSearchHighlightQuery(
  controller: EditorController | null,
  query: string | null
) {
  if (!controller) {
    return false;
  }

  const nextQuery = normalizeSearchQuery(query);
  if (controller.view.state.field(searchQueryField) === nextQuery) {
    return false;
  }

  controller.view.dispatch(
    controller.view.state.update({
      effects: setSearchQueryEffect.of(nextQuery)
    })
  );
  return true;
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
  viewCallbacks
}: CreateEditorOptions) {
  editorRoot.classList.add('gn-editor-root');

  const runtime = sharedResources?.runtime ?? new FileEditorRuntime(initialState?.markdown ?? initialValue);
  runtime.ensureMarkdown(initialState?.markdown ?? initialValue);

  const paneKey = Symbol('editor-pane');
  const slashMenuApi = createSlashMenuPlugin();
  let controller: EditorController | null = null;
  const extensions = [
    ...draftly({
      baseStyles: true,
      defaultKeybindings: false,
      history: false,
      lineWrapping: true,
      plugins: notepadDraftlyPlugins,
      extensions: createPaneExtensions(() => controller, editorRoot, sharedResources, slashMenuApi)
    })
  ];

  const view = new EditorView({
    state: createPaneState(
      initialState?.markdown ?? runtime.markdown,
      extensions,
      initialState?.selection ?? null
    ),
    parent: editorRoot,
    dispatchTransactions: (transactions, viewInstance) => {
      const currentController = controller;
      if (!currentController) {
        viewInstance.update(transactions);
        return;
      }
      runtime.dispatchFromPane(currentController, transactions);
    }
  });

  controller = {
    view,
    sharedResources,
    paneKey,
    onMarkdownChange
  };

  sharedResources?.registerViewCallbacks(view, viewCallbacks ?? defaultViewCallbacks);
  runtime.attachController(controller);
  slashMenuApi.register(view);

  return controller;
}

const defaultViewCallbacks: EditorViewCallbacks = {
  onOpenLink: () => {},
  onActiveWikilinkChange: () => {}
};

export async function destroyEditor(controller: EditorController | null) {
  if (!controller) {
    return null;
  }

  controller.sharedResources?.unregisterViewCallbacks(controller.view);
  controller.sharedResources?.runtime.detachController(controller);
  controller.view.destroy();
  return null;
}

export function replaceEditorContent(
  controller: EditorController | null,
  markdown: string,
  { flushHistory = false }: ReplaceEditorContentOptions = {}
) {
  if (!controller) {
    return false;
  }

  const runtime = controller.sharedResources?.runtime;
  if (runtime) {
    const snapshot: EditorSnapshot = {
      markdown,
      selection: readSelection(controller.view),
      revision: runtime.revision + 1
    };
    return runtime.applyExternalSnapshot(snapshot, controller, flushHistory);
  }

  controller.view.dispatch(
    controller.view.state.update({
      changes: { from: 0, to: controller.view.state.doc.length, insert: markdown },
      selection: readSelection(controller.view),
      annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full')]
    })
  );
  controller.onMarkdownChange(markdown);
  return true;
}

export function readEditorState(controller: EditorController | null): EditorSnapshot | null {
  if (!controller) {
    return null;
  }

  const runtime = controller.sharedResources?.runtime;
  if (runtime) {
    return runtime.snapshotFor(controller);
  }

  return {
    markdown: controller.view.state.doc.toString(),
    selection: readSelection(controller.view),
    revision: 0
  };
}

export function replaceEditorState(
  controller: EditorController | null,
  state: EditorSnapshot | null,
  { focus = false, scrollSelectionIntoView = false }: ReplaceEditorStateOptions = {}
) {
  if (!controller || !state) {
    return false;
  }

  const didReplace = controller.sharedResources?.runtime.applyExternalSnapshot(state, controller, false) ?? false;
  if (!didReplace) {
    controller.view.dispatch(
      controller.view.state.update({
        selection: state.selection,
        scrollIntoView: scrollSelectionIntoView
      })
    );
  }

  if (focus) {
    controller.view.focus();
  }
  return true;
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
    anchor: Math.max(0, Math.min(anchor ?? controller.view.state.selection.main.anchor, nextDocLength)),
    head: Math.max(0, Math.min(head ?? controller.view.state.selection.main.head, nextDocLength))
  };

  const snapshot: EditorSnapshot = {
    markdown,
    selection,
    revision: (controller.sharedResources?.runtime.revision ?? 0) + 1
  };

  const didReplace = controller.sharedResources?.runtime.applyExternalSnapshot(snapshot, controller, false) ?? false;
  if (!didReplace) {
    controller.view.dispatch(
      controller.view.state.update({
        changes: { from: 0, to: controller.view.state.doc.length, insert: markdown },
        selection,
        scrollIntoView: scrollSelectionIntoView
      })
    );
  } else if (scrollSelectionIntoView) {
    controller.view.dispatch(
      controller.view.state.update({
        selection,
        scrollIntoView: true
      })
    );
  }

  if (focus) {
    controller.view.focus();
  }
  return true;
}

export function readCursorPosition(controller: EditorController | null): CursorPosition | null {
  if (!controller) {
    return null;
  }
  return readSelection(controller.view);
}

export interface RestoreCursorPositionOptions {
  scrollIntoView?: boolean;
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
  controller.view.dispatch(
    controller.view.state.update({
      selection: { anchor, head },
      ...(scrollIntoView ? { scrollIntoView: true } : {}),
      annotations: [Transaction.addToHistory.of(false)]
    })
  );
  return true;
}

function pickVerticalScrollTarget(view: EditorView, outerShell: HTMLElement | null): HTMLElement {
  const inner = view.scrollDOM;
  if (inner.scrollHeight > inner.clientHeight + 1) {
    return inner;
  }
  if (outerShell && outerShell.scrollHeight > outerShell.clientHeight + 1) {
    return outerShell;
  }
  return inner;
}

/**
 * Scroll the editor's vertical scroll container (usually CodeMirror's `scrollDOM`)
 * so the caret sits near `fractionFromTop` of the visible viewport (0 = top).
 * `outerShell` is optional; when the inner scroller does not overflow, the shell
 * is used if it scrolls (some layouts scroll the pane wrapper instead).
 */
export function alignEditorScrollToSelection(
  controller: EditorController | null,
  outerShell: HTMLElement | null,
  fractionFromTop = 0.25
): boolean {
  if (!controller) {
    return false;
  }

  const view = controller.view;
  const scrollEl = pickVerticalScrollTarget(view, outerShell);
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  if (!coords) {
    view.requestMeasure();
    return false;
  }

  const portRect = scrollEl.getBoundingClientRect();
  const cursorMidY = (coords.top + coords.bottom) / 2;
  const offsetInViewport = cursorMidY - portRect.top;
  const contentY = scrollEl.scrollTop + offsetInViewport;
  const targetScroll = contentY - fractionFromTop * scrollEl.clientHeight;
  const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
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

  controller.view.dispatch(
    controller.view.state.update({
      changes: {
        from: activeWikilink.targetFrom,
        to: activeWikilink.targetTo,
        insert: suggestionValue
      },
      selection: {
        anchor: activeWikilink.targetFrom + suggestionValue.length
      }
    })
  );
  controller.view.focus();
  return true;
}

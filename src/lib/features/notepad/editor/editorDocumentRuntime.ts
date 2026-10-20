import { DocumentBody } from '../document/documentBody';
import {
  Annotation,
  EditorState,
  Text,
  Transaction,
  type EditorSelection as CmEditorSelection,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import type {
  EditorController,
  EditorSelection,
  EditorSnapshot
} from './types';
import { imageResizeHistory } from '../images/imageResizeHistory';

// The headless root owns text and shared undo, not syntax or input handling.
// Pane states install their own Markdown language and presentation extensions.
function documentRoot(text: Text) {
  return EditorState.create({
    doc: text,
    extensions: [history(), imageResizeHistory]
  });
}

function editorText(body: DocumentBody): Text {
  // Pane string construction uses CodeMirror's default CRLF/CR normalization.
  // Keep exact boundary bytes in the body until an edit, as before, but root
  // and pane change offsets must refer to the same normalized editor text.
  for (const chunk of body.text) {
    if (chunk.includes('\r')) return Text.of(body.toMarkdown().split(/\r\n?|\n/));
  }
  return body.text;
}

// CodeMirror annotations are nominal values. Keep the synchronization marker
// private to the runtime so pane views cannot accidentally emit it themselves.
const paneSyncAnnotation = Annotation.define<boolean>();

interface RuntimeReplaceOptions {
  flushHistory?: boolean;
  notifyBodyChange?: boolean;
  selectionByPaneKey?: Map<symbol, EditorSelection>;
  preferredPaneKey?: symbol | null;
}

function clampSelection(selection: EditorSelection, docLength: number): EditorSelection {
  const clamp = (pos: number) => Math.max(0, Math.min(pos, docLength));
  return { anchor: clamp(selection.anchor), head: clamp(selection.head) };
}

function readSelection(view: EditorView): EditorSelection {
  const selection = view.state.selection.main;
  return {
    anchor: selection.anchor,
    head: selection.head
  };
}

/**
 * CodeMirror may reset a view's DOM viewport while applying a document
 * transaction, even when that transaction carries no scroll request. Each
 * pane owns its viewport, so passive synchronization must preserve both axes.
 */
function updateViewPreservingViewport(
  view: EditorView,
  update: () => void
) {
  const scrollTop = view.scrollDOM.scrollTop;
  const scrollLeft = view.scrollDOM.scrollLeft;
  update();
  view.scrollDOM.scrollTop = scrollTop;
  view.scrollDOM.scrollLeft = scrollLeft;
}

function collectHistoryAnnotations(transaction: Transaction) {
  const annotations = [];
  const addToHistory = transaction.annotation(Transaction.addToHistory);
  if (addToHistory === false) {
    annotations.push(Transaction.addToHistory.of(false));
  }
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

/**
 * Build the transaction spec forwarded from a pane into the root state that
 * owns the document's canonical undo/redo history.
 */
export function buildRootForwardSpec(transaction: Transaction) {
  return {
    changes: transaction.changes,
    selection: transaction.newSelection,
    annotations: collectHistoryAnnotations(transaction)
  };
}

/**
 * Canonical live editor state for one note. The root EditorState owns
 * markdown and history; attached pane views receive the same document
 * transactions while retaining independent selections.
 */
export class EditorDocumentRuntime {
  revision = 0;
  readonly #paneControllers = new Map<
    symbol,
    EditorController
  >();
  #rootState: EditorState;
  #body: DocumentBody;
  #publicationLease: symbol | null = null;
  #adoptingPublication = false;

  constructor(initial: string | DocumentBody = '') {
    this.#body = typeof initial === 'string' ? DocumentBody.fromMarkdown(initial) : initial;
    this.#rootState = documentRoot(editorText(this.#body));
  }

  get markdown() {
    return this.body.toMarkdown();
  }

  get body() {
    return this.#body;
  }

  get attachedPaneCount() {
    return this.#paneControllers.size;
  }

  attachController(controller: EditorController) {
    this.#paneControllers.set(controller.paneKey, controller);
  }

  detachController(controller: EditorController) {
    this.#paneControllers.delete(controller.paneKey);
  }

  destroy() {
    this.#assertMutationAdmitted();
    this.#paneControllers.clear();
  }

  acquirePublicationLease() {
    if (this.#publicationLease) throw new Error('The editor already has a protected operation.');
    const token = Symbol('publication');
    this.#publicationLease = token;
    return () => { if (this.#publicationLease === token) this.#publicationLease = null; };
  }

  #assertMutationAdmitted() {
    if (this.#publicationLease && !this.#adoptingPublication) throw new Error('Canonical publication is settling.');
  }

  ensureMarkdown(markdown: string) {
    if (
      this.#paneControllers.size > 0 ||
      this.body.equals(DocumentBody.fromMarkdown(markdown))
    ) {
      return;
    }
    this.replaceMarkdown(markdown, { flushHistory: true });
  }

  dispatchFromPane(controller: EditorController, transactions: readonly Transaction[]) {
    const docChangedTransactions = transactions.filter(
      (transaction) =>
        transaction.docChanged && !transaction.annotation(paneSyncAnnotation)
    );
    if (docChangedTransactions.length === 0) {
      controller.view.update(transactions);
      return;
    }
    // Reject the whole batch: later selections may refer to rejected text.
    if (this.#publicationLease && !this.#adoptingPublication) return;

    for (const transaction of docChangedTransactions) {
      this.#rootState = this.#rootState.update({
        selection: transaction.startState.selection,
        annotations: Transaction.addToHistory.of(false)
      }).state;
      this.#rootState = this.#rootState.update(
        buildRootForwardSpec(transaction)
      ).state;
    }

    controller.view.update(transactions);
    this.#body = DocumentBody.fromText(this.#rootState.doc);
    this.revision += 1;
    this.#broadcastTransactions(docChangedTransactions, controller.paneKey);
    this.#notifyBodyChange(controller.paneKey);
  }

  applyRootTransactions(
    transactions: readonly Transaction[],
    preferredPaneKey: symbol | null
  ) {
    if (transactions.some(transaction => transaction.docChanged)) this.#assertMutationAdmitted();
    for (const transaction of transactions) {
      this.#rootState = transaction.state;
    }
    const docChangedTransactions = transactions.filter(
      (transaction) => transaction.docChanged
    );
    if (docChangedTransactions.length === 0) {
      return;
    }

    this.#body = DocumentBody.fromText(this.#rootState.doc);
    this.revision += 1;
    this.#broadcastTransactions(docChangedTransactions, null, {
      paneKey: preferredPaneKey,
      selection: this.#rootState.selection
    });
    this.#notifyBodyChange(preferredPaneKey);
  }

  replaceMarkdown(markdown: string, options: RuntimeReplaceOptions = {}) {
    return this.replaceBody(DocumentBody.fromMarkdown(markdown), options);
  }

  replaceBody(body: DocumentBody, options: RuntimeReplaceOptions = {}) {
    this.#assertMutationAdmitted();
    if (!options.flushHistory && this.body.equals(body)) {
      return false;
    }

    const selectionByPaneKey =
      options.selectionByPaneKey ?? new Map<symbol, EditorSelection>();
    const text = editorText(body);
    if (options.flushHistory) {
      this.#rootState = documentRoot(text);
    } else {
      this.#rootState = this.#rootState.update({
        changes: {
          from: 0,
          to: this.#rootState.doc.length,
          insert: text
        },
        annotations: [
          Transaction.addToHistory.of(false),
          isolateHistory.of('full')
        ]
      }).state;
    }
    this.#body = body;

    const nextDocLength = text.length;
    for (const [paneKey, controller] of this.#paneControllers) {
      const rawSelection =
        selectionByPaneKey.get(paneKey) ?? readSelection(controller.view);
      const selection = clampSelection(rawSelection, nextDocLength);
      updateViewPreservingViewport(controller.view, () => {
        controller.view.dispatch(
          controller.view.state.update({
            changes: {
              from: 0,
              to: controller.view.state.doc.length,
              insert: text
            },
            selection,
            annotations: [
              paneSyncAnnotation.of(true),
              Transaction.addToHistory.of(false),
              isolateHistory.of('full'),
              Transaction.userEvent.of('input.external-reset')
            ]
          })
        );
      });
    }

    this.revision += 1;
    if (options.notifyBodyChange !== false) {
      this.#notifyBodyChange(options.preferredPaneKey ?? null);
    }
    return true;
  }

  /**
   * Adopt canonical document content without turning the synchronization
   * callback into another user edit. Every committed replacement starts a
   * fresh shared undo root while pane selections and viewports remain local.
   */
  adoptCommittedMarkdown(markdown: string) {
    return this.adoptCommittedBody(DocumentBody.fromMarkdown(markdown));
  }

  adoptCommittedBody(body: DocumentBody) {
    this.#adoptingPublication = true;
    try {
      return this.replaceBody(body, {
        flushHistory: true,
        notifyBodyChange: false
      });
    } finally { this.#adoptingPublication = false; }
  }

  /** Restore a transient draft without presenting it as another pane edit. */
  restoreTransientMarkdown(markdown: string) {
    return this.replaceMarkdown(markdown, {
      notifyBodyChange: false
    });
  }

  applyExternalSnapshot(
    snapshot: EditorSnapshot,
    controller: EditorController | null,
    flushHistory = false
  ) {
    const selectionByPaneKey = new Map<symbol, EditorSelection>();
    for (const [paneKey, paneController] of this.#paneControllers) {
      selectionByPaneKey.set(
        paneKey,
        controller && paneKey === controller.paneKey
          ? snapshot.selection
          : readSelection(paneController.view)
      );
    }

    return this.replaceMarkdown(snapshot.markdown, {
      flushHistory,
      selectionByPaneKey,
      preferredPaneKey: controller?.paneKey ?? null
    });
  }

  undo(preferredPaneKey: symbol | null) {
    if (this.#publicationLease) return false;
    return undo({
      state: this.#rootState,
      dispatch: (transaction) =>
        this.applyRootTransactions([transaction], preferredPaneKey)
    });
  }

  redo(preferredPaneKey: symbol | null) {
    if (this.#publicationLease) return false;
    return redo({
      state: this.#rootState,
      dispatch: (transaction) =>
        this.applyRootTransactions([transaction], preferredPaneKey)
    });
  }

  snapshotFor(controller: EditorController): EditorSnapshot {
    return {
      markdown: this.markdown,
      selection: readSelection(controller.view),
      revision: this.revision
    };
  }

  #broadcastTransactions(
    transactions: readonly Transaction[],
    sourcePaneKey: symbol | null,
    restoreSelection: {
      paneKey: symbol | null;
      selection: CmEditorSelection;
    } | null = null
  ) {
    for (const [paneKey, controller] of this.#paneControllers) {
      if (sourcePaneKey && paneKey === sourcePaneKey) {
        continue;
      }

      let paneState = controller.view.state;
      const updates = transactions.map((transaction, index) => {
        const applyHere =
          restoreSelection?.paneKey === paneKey &&
          index === transactions.length - 1;
        const update = paneState.update({
          changes: transaction.changes,
          selection: applyHere ? restoreSelection.selection : undefined,
          scrollIntoView: applyHere,
          annotations: [
            paneSyncAnnotation.of(true),
            Transaction.addToHistory.of(false)
          ]
        });
        // Each change set uses the document produced by the preceding edit.
        paneState = update.state;
        return update;
      });
      updateViewPreservingViewport(
        controller.view,
        () => controller.view.update(updates)
      );
    }
  }

  #notifyBodyChange(preferredPaneKey: symbol | null) {
    const preferredController = preferredPaneKey
      ? this.#paneControllers.get(preferredPaneKey)
      : null;
    const controller =
      preferredController ??
      this.#paneControllers.values().next().value ??
      null;
    controller?.onBodyChange(this.body);
  }
}

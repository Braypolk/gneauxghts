import {
  Annotation,
  EditorState,
  Transaction,
  type EditorSelection as CmEditorSelection,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory, redo, undo } from '@codemirror/commands';
import type {
  EditorController,
  EditorSelection,
  EditorSnapshot
} from './types';
import { createRootState } from './editorExtensions';

// CodeMirror annotations are nominal values. Keep the synchronization marker
// private to the runtime so pane views cannot accidentally emit it themselves.
const paneSyncAnnotation = Annotation.define<boolean>();

interface RuntimeReplaceOptions {
  flushHistory?: boolean;
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
  #markdownCache: string | null = null;

  constructor(initialMarkdown = '') {
    this.#rootState = createRootState(initialMarkdown);
    this.#markdownCache = initialMarkdown;
  }

  get markdown() {
    return (this.#markdownCache ??= this.#rootState.doc.toString());
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
    this.#paneControllers.clear();
  }

  ensureMarkdown(markdown: string) {
    if (
      this.#paneControllers.size > 0 ||
      this.markdown === markdown
    ) {
      return;
    }
    this.replaceMarkdown(markdown, { flushHistory: true });
  }

  dispatchFromPane(controller: EditorController, transactions: readonly Transaction[]) {
    controller.view.update(transactions);

    const docChangedTransactions = transactions.filter(
      (transaction) =>
        transaction.docChanged && !transaction.annotation(paneSyncAnnotation)
    );
    if (docChangedTransactions.length === 0) {
      return;
    }

    for (const transaction of docChangedTransactions) {
      this.#rootState = this.#rootState.update({
        selection: transaction.startState.selection,
        annotations: Transaction.addToHistory.of(false)
      }).state;
      this.#rootState = this.#rootState.update(
        buildRootForwardSpec(transaction)
      ).state;
    }

    this.#markdownCache = null;
    this.revision += 1;
    this.#broadcastTransactions(docChangedTransactions, controller.paneKey);
    this.#notifyMarkdownChange(controller.paneKey);
  }

  applyRootTransactions(
    transactions: readonly Transaction[],
    preferredPaneKey: symbol | null
  ) {
    for (const transaction of transactions) {
      this.#rootState = transaction.state;
    }
    const docChangedTransactions = transactions.filter(
      (transaction) => transaction.docChanged
    );
    if (docChangedTransactions.length === 0) {
      return;
    }

    this.#markdownCache = null;
    this.revision += 1;
    this.#broadcastTransactions(docChangedTransactions, null, {
      paneKey: preferredPaneKey,
      selection: this.#rootState.selection
    });
    this.#notifyMarkdownChange(preferredPaneKey);
  }

  replaceMarkdown(markdown: string, options: RuntimeReplaceOptions = {}) {
    if (!options.flushHistory && this.markdown === markdown) {
      return false;
    }

    const selectionByPaneKey =
      options.selectionByPaneKey ?? new Map<symbol, EditorSelection>();
    if (options.flushHistory) {
      this.#rootState = createRootState(markdown);
    } else {
      this.#rootState = this.#rootState.update({
        changes: {
          from: 0,
          to: this.#rootState.doc.length,
          insert: markdown
        },
        annotations: [
          Transaction.addToHistory.of(false),
          isolateHistory.of('full')
        ]
      }).state;
    }
    this.#markdownCache = markdown;

    const nextDocLength = markdown.length;
    for (const [paneKey, controller] of this.#paneControllers) {
      const rawSelection =
        selectionByPaneKey.get(paneKey) ?? readSelection(controller.view);
      const selection = clampSelection(rawSelection, nextDocLength);
      controller.view.dispatch(
        controller.view.state.update({
          changes: {
            from: 0,
            to: controller.view.state.doc.length,
            insert: markdown
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
    }

    this.revision += 1;
    this.#notifyMarkdownChange(options.preferredPaneKey ?? null);
    return true;
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
    return undo({
      state: this.#rootState,
      dispatch: (transaction) =>
        this.applyRootTransactions([transaction], preferredPaneKey)
    });
  }

  redo(preferredPaneKey: symbol | null) {
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

      const updates = transactions.map((transaction, index) => {
        const applyHere =
          restoreSelection?.paneKey === paneKey &&
          index === transactions.length - 1;
        return controller.view.state.update({
          changes: transaction.changes,
          selection: applyHere ? restoreSelection.selection : undefined,
          scrollIntoView: applyHere,
          annotations: [
            paneSyncAnnotation.of(true),
            Transaction.addToHistory.of(false)
          ]
        });
      });
      controller.view.update(updates);
    }
  }

  #notifyMarkdownChange(preferredPaneKey: symbol | null) {
    const preferredController = preferredPaneKey
      ? this.#paneControllers.get(preferredPaneKey)
      : null;
    const controller =
      preferredController ??
      this.#paneControllers.values().next().value ??
      null;
    controller?.onMarkdownChange(this.markdown);
  }
}

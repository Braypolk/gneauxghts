import {
  Annotation,
  EditorState,
  Transaction,
  StateEffect,
  type ChangeSpec,
  type EditorSelection as CmEditorSelection,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, historyKeymap, isolateHistory, redo, undo } from '@codemirror/commands';
import type {
  EditorController,
  EditorSelection,
  EditorSnapshot
} from './types';
import { createMarkdownBaseExtensions } from './editorShortcuts';
import { imageResizeHistory } from '../images/imageResizeHistory';
import type { ProposalPreview } from '$lib/types/proposals';
import { createReviewProjection, documentReviewField, proposalTransaction, publishReviewProjection, resolveReviewHunk, reviewProjection, setDocumentReview } from '$lib/features/proposals/reviewExtension';

interface ReviewCallbacks {
  onKeep: (reviewId: string, hunkId: string) => void;
  onUndo: (reviewId: string, hunkId: string) => void;
  onChange: () => void;
  onMarkdownChange: (markdown: string) => void;
}

function documentRoot(markdown: string) {
  return EditorState.create({
    doc: markdown,
    extensions: [
      history(),
      imageResizeHistory,
      keymap.of(historyKeymap),
      createMarkdownBaseExtensions()
    ]
  }).update({ effects: StateEffect.appendConfig.of(documentReviewField) }).state;
}

// CodeMirror annotations are nominal values. Keep the synchronization marker
// private to the runtime so pane views cannot accidentally emit it themselves.
const paneSyncAnnotation = Annotation.define<boolean>();

interface RuntimeReplaceOptions {
  flushHistory?: boolean;
  notifyMarkdownChange?: boolean;
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
  if (transaction.annotation(proposalTransaction)) annotations.push(proposalTransaction.of(true));
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
  #reviewCallbacks: ReviewCallbacks | null = null;
  readonly #keepReviewHunk = (reviewId: string, hunkId: string) => this.#reviewCallbacks?.onKeep(reviewId, hunkId);
  readonly #undoReviewHunk = (reviewId: string, hunkId: string) => this.#reviewCallbacks?.onUndo(reviewId, hunkId);

  constructor(initialMarkdown = '') {
    this.#rootState = documentRoot(initialMarkdown);
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
    this.#publishReview();
  }

  detachController(controller: EditorController) {
    this.#paneControllers.delete(controller.paneKey);
  }

  destroy() {
    this.#reviewCallbacks = null;
    this.#paneControllers.clear();
  }

  get review() { return this.#rootState.field(documentReviewField); }

  beginReview(preview: ProposalPreview, callbacks: ReviewCallbacks, working?: { markdown: string; decisions: import('$lib/features/proposals/reviewExtension').ReviewHunkState[] }) {
    if (this.review) throw new Error('A review is already active for this document.');
    if (this.markdown !== preview.baseEditorMarkdown) throw new Error('Note changed before review.');
    this.#reviewCallbacks = callbacks;
    this.applyRootTransactions([this.#rootState.update({
      changes: working ? { from: 0, to: this.markdown.length, insert: working.markdown } : preview.hunks.map(hunk => ({ from: hunk.baseFrom, to: hunk.baseTo, insert: hunk.newText })),
      effects: setDocumentReview.of({ reviewId: preview.reviewId, hunks: working?.decisions.length ? working.decisions : preview.hunks.map(hunk => ({ ...hunk, from: hunk.proposedFrom, to: hunk.proposedTo, status: 'pending' })) }),
      annotations: [proposalTransaction.of(true), Transaction.addToHistory.of(false), isolateHistory.of('full')]
    })], null);
  }

  bindReviewCallbacks(reviewId: string, callbacks: ReviewCallbacks) {
    if (this.review?.reviewId !== reviewId) return;
    this.#reviewCallbacks = callbacks;
    this.#publishReview();
  }

  resolveReview(reviewId: string, ids: string[], status: 'kept' | 'undone', changes?: ChangeSpec) {
    if (this.review?.reviewId !== reviewId) return false;
    this.applyRootTransactions([this.#rootState.update({
      changes,
      effects: ids.map(id => resolveReviewHunk.of({ id, status })),
      annotations: [proposalTransaction.of(true), Transaction.addToHistory.of(false), isolateHistory.of('full')]
    })], null);
    return true;
  }

  endReview(reviewId: string) {
    if (this.review?.reviewId !== reviewId) return;
    this.#rootState = this.#rootState.update({ effects: setDocumentReview.of(null) }).state;
    this.#publishReview();
    this.#reviewCallbacks = null;
  }

  #reviewEffect(controller: EditorController, state = controller.view.state) {
    const projection = state.field(reviewProjection, false);
    const review = this.review;
    return review && this.#reviewCallbacks
      ? projection
        ? publishReviewProjection.of(review)
        : controller.proposalReviewCompartment.reconfigure(createReviewProjection(
            review, this.#keepReviewHunk, this.#undoReviewHunk))
      : projection ? controller.proposalReviewCompartment.reconfigure([]) : undefined;
  }

  #publishReview() {
    for (const controller of this.#paneControllers.values()) {
      const effect = this.#reviewEffect(controller);
      if (effect) controller.view.update([controller.view.state.update({ effects: effect })]);
    }
  }

  ensureMarkdown(markdown: string) {
    if (
      this.review ||
      this.#paneControllers.size > 0 ||
      this.markdown === markdown
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

    for (const transaction of docChangedTransactions) {
      this.#rootState = this.#rootState.update({
        selection: transaction.startState.selection,
        annotations: Transaction.addToHistory.of(false)
      }).state;
      this.#rootState = this.#rootState.update(
        buildRootForwardSpec(transaction)
      ).state;
    }

    // Publish root metadata in the same view update as its text. Rendering an
    // intermediate pane state would expose old decoration ranges in the new doc.
    const finalState = transactions[transactions.length - 1].state;
    const effect = this.#reviewEffect(controller, finalState);
    controller.view.update(effect ? [...transactions, finalState.update({ effects: effect })] : transactions);
    this.#markdownCache = null;
    this.revision += 1;
    this.#broadcastTransactions(docChangedTransactions, controller.paneKey);
    this.#notifyMarkdownChange(controller.paneKey);
    this.#reviewCallbacks?.onChange();
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
      this.#publishReview();
      this.#reviewCallbacks?.onChange();
      return;
    }

    this.#markdownCache = null;
    this.revision += 1;
    this.#broadcastTransactions(docChangedTransactions, null, {
      paneKey: preferredPaneKey,
      selection: this.#rootState.selection
    });
    this.#notifyMarkdownChange(preferredPaneKey);
    this.#reviewCallbacks?.onChange();
  }

  replaceMarkdown(markdown: string, options: RuntimeReplaceOptions = {}) {
    if (!options.flushHistory && this.markdown === markdown) {
      return false;
    }

    const selectionByPaneKey =
      options.selectionByPaneKey ?? new Map<symbol, EditorSelection>();
    if (options.flushHistory) {
      this.#rootState = documentRoot(markdown);
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
      updateViewPreservingViewport(controller.view, () => {
        controller.view.dispatch(
          controller.view.state.update({
            changes: {
              from: 0,
              to: controller.view.state.doc.length,
              insert: markdown
            },
            selection,
            effects: this.#reviewEffect(controller),
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

    this.#publishReview();
    if (!this.review) this.#reviewCallbacks = null;
    this.revision += 1;
    if (options.notifyMarkdownChange !== false) {
      this.#notifyMarkdownChange(options.preferredPaneKey ?? null);
    }
    return true;
  }

  /**
   * Adopt canonical document content without turning the synchronization
   * callback into another user edit. Every committed replacement starts a
   * fresh shared undo root while pane selections and viewports remain local.
   */
  adoptCommittedMarkdown(markdown: string) {
    return this.replaceMarkdown(markdown, {
      flushHistory: true,
      notifyMarkdownChange: false
    });
  }

  /** Restore a transient draft without presenting it as another pane edit. */
  restoreTransientMarkdown(markdown: string) {
    return this.replaceMarkdown(markdown, {
      notifyMarkdownChange: false
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

      let paneState = controller.view.state;
      const updates = transactions.map((transaction, index) => {
        const applyHere =
          restoreSelection?.paneKey === paneKey &&
          index === transactions.length - 1;
        const update = paneState.update({
          changes: transaction.changes,
          selection: applyHere ? restoreSelection.selection : undefined,
          scrollIntoView: applyHere,
          effects: index === transactions.length - 1 ? this.#reviewEffect(controller, paneState) : undefined,
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

  #notifyMarkdownChange(preferredPaneKey: symbol | null) {
    if (this.review && this.#reviewCallbacks) {
      this.#reviewCallbacks.onMarkdownChange(this.markdown);
      return;
    }
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

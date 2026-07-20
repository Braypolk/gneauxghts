import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Range
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { ProposalPreviewHunk } from '$lib/types/proposals';

export type ReviewHunkStatus = 'pending' | 'kept' | 'undone' | 'modified';

export interface ReviewHunkState extends ProposalPreviewHunk {
  from: number;
  to: number;
  status: ReviewHunkStatus;
}

export interface ProposalReviewState {
  reviewId: string;
  hunks: ReviewHunkState[];
}

export const proposalTransaction = Annotation.define<boolean>();
export const resolveReviewHunk = StateEffect.define<{ id: string; status: ReviewHunkStatus }>();

class DeletedAnchorWidget extends WidgetType {
  toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'cm-gn-proposal-deleted-anchor';
    marker.textContent = '−';
    marker.setAttribute('aria-label', 'Proposed deletion');
    return marker;
  }
}

const added = Decoration.mark({ class: 'cm-gn-proposal-added' });
const anchor = Decoration.widget({ widget: new DeletedAnchorWidget(), side: 1 });

class HunkActionsWidget extends WidgetType {
  constructor(
    readonly hunk: ReviewHunkState,
    readonly onKeep: (hunk: ReviewHunkState) => void,
    readonly onUndo: (hunk: ReviewHunkState) => void
  ) {
    super();
  }

  eq(other: HunkActionsWidget) {
    // The callbacks receive this widget's hunk snapshot. Bounds must be part
    // of equality so CodeMirror replaces the widget after user edits map the
    // range; otherwise Undo would act on the original proposed span.
    return (
      other.hunk.id === this.hunk.id &&
      other.hunk.status === this.hunk.status &&
      other.hunk.from === this.hunk.from &&
      other.hunk.to === this.hunk.to &&
      other.hunk.oldText === this.hunk.oldText &&
      other.hunk.newText === this.hunk.newText
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-gn-proposal-actions';
    wrap.contentEditable = 'false';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'cm-gn-proposal-undo';
    undo.textContent = 'Undo';
    undo.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    undo.addEventListener('click', (event) => {
      event.preventDefault();
      this.onUndo(this.hunk);
    });
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'cm-gn-proposal-keep';
    keep.textContent = 'Keep';
    keep.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    keep.addEventListener('click', (event) => {
      event.preventDefault();
      this.onKeep(this.hunk);
    });
    wrap.append(undo, keep);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function intersects(change: { fromA: number; toA: number }, hunk: ReviewHunkState): boolean {
  if (hunk.from === hunk.to) return change.fromA <= hunk.from && change.toA >= hunk.from;
  return change.fromA < hunk.to && change.toA > hunk.from;
}

function decorations(state: ProposalReviewState, onKeep: ProposalReviewOptions['onKeep'], onUndo: ProposalReviewOptions['onUndo']): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const hunk of state.hunks) {
    if (hunk.status === 'kept' || hunk.status === 'undone') continue;
    if (hunk.from < hunk.to) ranges.push(added.range(hunk.from, hunk.to));
    else ranges.push(anchor.range(hunk.from));
    ranges.push(
      Decoration.widget({
        widget: new HunkActionsWidget(hunk, onKeep, onUndo),
        side: 1
      }).range(hunk.to)
    );
  }
  return Decoration.set(ranges.sort((a, b) => a.from - b.from));
}

export interface ProposalReviewOptions {
  reviewId: string;
  hunks: ProposalPreviewHunk[];
  initialHunks?: ReviewHunkState[];
  onKeep: (hunk: ReviewHunkState) => void;
  onUndo: (hunk: ReviewHunkState) => void;
  onStateChange?: (state: ProposalReviewState) => void;
}

export interface ProposalReviewExtensionHandle {
  extension: Extension;
  read: (state: EditorState) => ProposalReviewState;
}

/** Editable review metadata layered over real proposed editor text. */
export function createProposalReviewExtension(options: ProposalReviewOptions): ProposalReviewExtensionHandle {
  const field = StateField.define<ProposalReviewState>({
    create() {
      return {
        reviewId: options.reviewId,
        hunks: (options.initialHunks ?? options.hunks.map((hunk) => ({
          ...hunk,
          from: hunk.proposedFrom,
          to: hunk.proposedTo,
          status: 'pending'
        }))).map((hunk) => ({ ...hunk }))
      };
    },
    update(value, transaction) {
      let hunks = value.hunks;
      for (const effect of transaction.effects) {
        if (effect.is(resolveReviewHunk)) {
          hunks = hunks.map((hunk) =>
            hunk.id === effect.value.id ? { ...hunk, status: effect.value.status } : hunk
          );
        }
      }
      if (!transaction.docChanged) {
        return { ...value, hunks };
      }
      const isProposalTransaction = transaction.annotation(proposalTransaction);
      // The shared editor runtime occasionally replaces an entire pane buffer
      // while mounting or rebinding it. That is a view synchronization, not a
      // user change to every proposal hunk.
      const isExternalDocumentReset = transaction.annotation(Transaction.userEvent) === 'input.external-reset';
      if (isExternalDocumentReset) {
        return { ...value, hunks };
      }
      const changed: ReviewHunkState[] = hunks.map((hunk): ReviewHunkState => {
        const isDeletionAnchor = hunk.from === hunk.to;
        const mappedFrom = transaction.changes.mapPos(hunk.from, isDeletionAnchor ? -1 : 1);
        const mappedTo = transaction.changes.mapPos(hunk.to, isDeletionAnchor ? 1 : -1);
        if (hunk.status === 'kept' || hunk.status === 'undone') {
          return { ...hunk, from: mappedFrom, to: mappedTo };
        }
        let modified = false;
        let changedFrom = Number.POSITIVE_INFINITY;
        let changedTo = Number.NEGATIVE_INFINITY;
        if (!isProposalTransaction) {
          transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
            if (intersects({ fromA, toA }, hunk)) {
              modified = true;
              changedFrom = Math.min(changedFrom, fromB);
              changedTo = Math.max(changedTo, toB);
            }
          });
        }
        // A replacement can map a hunk's endpoints across each other (for
        // example, replacing the entire proposed text). When that happens,
        // the post-change span is authoritative: restoring must replace the
        // complete live region, never a mixed old/new slice.
        const from = modified ? Math.min(mappedFrom, mappedTo, changedFrom) : mappedFrom;
        const to = modified ? Math.max(mappedFrom, mappedTo, changedTo) : mappedTo;
        return {
          ...hunk,
          // Boundary insertions beside a regular hunk are outside it. A
          // deletion anchor is different: a change at the anchor is part of
          // the user-modified replacement and must expand the tracked range.
          from,
          to,
          status: modified && from === to ? 'kept' : modified ? 'modified' : hunk.status
        };
      });
      return { ...value, hunks: changed };
    },
    provide: (field) => EditorView.decorations.compute([field], (state) =>
      decorations(state.field(field), options.onKeep, options.onUndo)
    )
  });
  return {
    extension: [
      field,
      EditorView.editorAttributes.of({ 'data-proposal-review': 'true' }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged && !update.transactions.some((transaction) => transaction.effects.length)) return;
        const next = update.state.field(field);
        queueMicrotask(() => options.onStateChange?.(next));
      })
    ],
    read: (state) => state.field(field)
  };
}

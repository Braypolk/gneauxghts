import {
  Annotation,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Range,
  type Text
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import MarkdownIt from 'markdown-it';
import type { ProposalPreviewHunk } from '$lib/types/proposals';

import type { ReviewHunkState, ReviewHunkStatus } from '$lib/types/proposals';
export type { ReviewHunkState, ReviewHunkStatus } from '$lib/types/proposals';

export interface ProposalReviewState {
  reviewId: string;
  hunks: ReviewHunkState[];
}

export const proposalTransaction = Annotation.define<boolean>();
export const resolveReviewHunk = StateEffect.define<{ id: string; status: ReviewHunkStatus }>();
const removedMarkdown = new MarkdownIt({ html: false, linkify: false, breaks: true });

class ChangeLabelWidget extends WidgetType {
  constructor(readonly kind: 'added' | 'removed') {
    super();
  }

  eq(other: ChangeLabelWidget) {
    return other.kind === this.kind;
  }

  toDOM(): HTMLElement {
    const label = document.createElement('span');
    label.className = `cm-gn-proposal-change-label cm-gn-proposal-${this.kind}-label`;
    label.textContent = this.kind === 'added' ? '+' : '−';
    label.setAttribute('aria-label', this.kind === 'added' ? 'Added' : 'Removed');
    label.contentEditable = 'false';
    return label;
  }

  ignoreEvent() {
    return true;
  }
}

class RemovedTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: RemovedTextWidget) {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-gn-proposal-removed-block';
    wrap.contentEditable = 'false';

    const label = new ChangeLabelWidget('removed').toDOM();
    const content = document.createElement('div');
    content.className = 'cm-gn-proposal-removed-text';
    // Raw HTML is disabled above, so note text cannot inject arbitrary DOM.
    // Rendering here lets rejected headings, lists, emphasis, and indentation
    // remain legible even though that text is no longer in the editor state.
    content.innerHTML = removedMarkdown.render(this.text);

    wrap.append(label, content);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

const addedLine = {
  single: Decoration.line({
    class: 'cm-gn-proposal-added-line cm-gn-proposal-added-line-single'
  }),
  start: Decoration.line({
    class: 'cm-gn-proposal-added-line cm-gn-proposal-added-line-start'
  }),
  middle: Decoration.line({
    class: 'cm-gn-proposal-added-line cm-gn-proposal-added-line-middle'
  }),
  end: Decoration.line({
    class: 'cm-gn-proposal-added-line cm-gn-proposal-added-line-end'
  })
};

class HunkActionsWidget extends WidgetType {
  constructor(
    readonly reviewId: string,
    readonly hunk: ReviewHunkState,
    readonly onKeep: (reviewId: string, hunkId: string) => void,
    readonly onUndo: (reviewId: string, hunkId: string) => void
  ) {
    super();
  }

  eq(other: HunkActionsWidget) {
    // The review identity prevents a reused widget from dispatching an action
    // for a superseded proposal that happens to have identical hunk bounds.
    return (
      other.reviewId === this.reviewId &&
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
      this.onUndo(this.reviewId, this.hunk.id);
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
      this.onKeep(this.reviewId, this.hunk.id);
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

function addedLineRanges(doc: Text, hunk: ReviewHunkState): Range<Decoration>[] {
  if (hunk.from >= hunk.to || doc.length === 0) return [];
  const first = doc.lineAt(Math.min(hunk.from, doc.length));
  const last = doc.lineAt(Math.min(Math.max(hunk.from, hunk.to - 1), doc.length));
  const ranges: Range<Decoration>[] = [];
  for (let number = first.number; number <= last.number; number += 1) {
    const line = doc.line(number);
    const decoration =
      first.number === last.number
        ? addedLine.single
        : number === first.number
          ? addedLine.start
          : number === last.number
            ? addedLine.end
            : addedLine.middle;
    ranges.push(decoration.range(line.from));
  }
  return ranges;
}

function decorations(
  doc: Text,
  state: ProposalReviewState,
  onKeep: (reviewId: string, hunkId: string) => void,
  onUndo: (reviewId: string, hunkId: string) => void
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const hunk of state.hunks) {
    if (hunk.status === 'kept' || hunk.status === 'undone') continue;
    if (hunk.oldText.length > 0) {
      ranges.push(
        Decoration.widget({
          widget: new RemovedTextWidget(hunk.oldText),
          block: true,
          side: -2
        }).range(hunk.from)
      );
    }
    if (hunk.from < hunk.to) {
      ranges.push(...addedLineRanges(doc, hunk));
    }
    ranges.push(
      Decoration.widget({
        widget: new HunkActionsWidget(state.reviewId, hunk, onKeep, onUndo),
        side: 1
      }).range(hunk.to)
    );
  }
  return Decoration.set(ranges, true);
}

// Only the document root maps positions and owns resolution status.
export const setDocumentReview = StateEffect.define<ProposalReviewState | null>();
export const documentReviewField = StateField.define<ProposalReviewState | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged) {
      const hunks = value.hunks;
      const isProposalTransaction = transaction.annotation(proposalTransaction);
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

      value = { ...value, hunks: changed };
    }
    for (const effect of transaction.effects) {
      if (effect.is(setDocumentReview)) value = effect.value;
      else if (value && effect.is(resolveReviewHunk)) {
        value = { ...value, hunks: value.hunks.map(hunk => hunk.id === effect.value.id
          ? { ...hunk, status: effect.value.status } : hunk) };
      }
    }
    return value;
  }
});

// Pane metadata is a read-only projection: view edits never map it independently.
export const publishReviewProjection = StateEffect.define<ProposalReviewState>();
export const reviewProjection = StateField.define<ProposalReviewState | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(publishReviewProjection)) return effect.value;
    }
    return value;
  }
});

export function createReviewProjection(
  state: ProposalReviewState,
  onKeep: (reviewId: string, hunkId: string) => void,
  onUndo: (reviewId: string, hunkId: string) => void
): Extension {
  return [
    reviewProjection.init(() => state),
    EditorView.editorAttributes.of({ 'data-proposal-review': 'true' }),
    EditorView.decorations.compute([reviewProjection], viewState => {
      const review = viewState.field(reviewProjection);
      return review ? decorations(viewState.doc, review, onKeep, onUndo) : Decoration.none;
    })
  ];
}

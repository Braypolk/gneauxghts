import {
  Decoration,
  EditorView,
  WidgetType,
  type Decoration as DecorationType,
  type DecorationSet
} from '@codemirror/view';
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import type { DiffLine } from './diffModel';
import type { PendingProposalChange } from './types';

export interface ProposalReviewEditorState {
  changeId: string;
  lines: DiffLine[];
}

const removedLine = Decoration.line({ class: 'cm-gn-proposal-removed' });
const addedLine = Decoration.line({ class: 'cm-gn-proposal-added' });

class ProposalActionsWidget extends WidgetType {
  constructor(
    readonly changeId: string,
    readonly onKeep: (changeId: string) => void,
    readonly onUndo: (changeId: string) => void
  ) {
    super();
  }

  override eq(other: ProposalActionsWidget): boolean {
    return other.changeId === this.changeId;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-gn-proposal-actions';
    wrap.contentEditable = 'false';

    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'cm-gn-proposal-undo';
    undo.textContent = 'Undo';
    undo.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.onUndo(this.changeId);
    });

    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'cm-gn-proposal-keep';
    keep.textContent = 'Keep';
    keep.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.onKeep(this.changeId);
    });

    wrap.append(undo, keep);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

export interface ProposalReviewExtensionOptions {
  review: ProposalReviewEditorState;
  onKeep: (changeId: string) => void;
  onUndo: (changeId: string) => void;
}

function buildDecorations(
  state: EditorState,
  review: ProposalReviewEditorState,
  options: ProposalReviewExtensionOptions
): DecorationSet {
  if (review.lines.length === 0 || state.doc.lines === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<DecorationType>();
  const doc = state.doc;
  const lineCount = Math.min(review.lines.length, doc.lines);

  for (let i = 0; i < lineCount; i += 1) {
    const meta = review.lines[i];
    const line = doc.line(i + 1);
    if (meta?.kind === 'removed') {
      builder.add(line.from, line.from, removedLine);
    } else if (meta?.kind === 'added') {
      builder.add(line.from, line.from, addedLine);
    }
  }

  // Block widgets must come from a StateField — ViewPlugin decorations cannot be block.
  const lastLine = doc.line(doc.lines);
  builder.add(
    lastLine.to,
    lastLine.to,
    Decoration.widget({
      widget: new ProposalActionsWidget(review.changeId, options.onKeep, options.onUndo),
      side: 1,
      block: true
    })
  );

  return builder.finish();
}

/**
 * Review decorations close over the review model so a single compartment
 * reconfigure is enough — no separate StateEffect race with field creation.
 *
 * Uses StateField (not ViewPlugin) because the Keep/Undo control is a block widget.
 */
export function createProposalReviewExtension(
  options: ProposalReviewExtensionOptions
): Extension {
  const decorationsField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, options.review, options);
    },
    update(decorations, transaction) {
      if (transaction.docChanged) {
        return buildDecorations(transaction.state, options.review, options);
      }
      return decorations.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field)
  });

  return [
    decorationsField,
    EditorView.editable.of(false),
    EditorView.editorAttributes.of({ 'data-proposal-review': 'true' })
  ];
}

export function reviewStateFromChange(
  change: PendingProposalChange
): ProposalReviewEditorState {
  return {
    changeId: change.id,
    lines: change.diff.lines
  };
}

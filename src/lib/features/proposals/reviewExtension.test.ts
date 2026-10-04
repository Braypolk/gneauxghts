import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { EditorView, type WidgetType } from '@codemirror/view';
import { createReviewProjection, documentReviewField, setDocumentReview } from './reviewExtension';

describe('proposal review hunk mapping', () => {
  it('tracks the complete edited proposed span for Restore Original', () => {
    const state = EditorState.create({ doc: 'Fixture (revised)', extensions: documentReviewField });
    const reviewing = state.update({ effects: setDocumentReview.of({ reviewId: 'review', hunks: [{
      id: 'hunk-1', baseFrom: 0, baseTo: 7, proposedFrom: 0, proposedTo: 17,
      oldText: 'Fixture', newText: 'Fixture (revised)', from: 0, to: 17, status: 'pending'
    }] }) }).state;
    const next = reviewing.update({ changes: { from: 0, to: 7, insert: 'Fixture test' } }).state;
    const hunk = next.field(documentReviewField)!.hunks[0];
    expect(next.doc.toString().slice(hunk.from, hunk.to)).toBe('Fixture test (revised)');
    expect(hunk.status).toBe('modified');
  });
  it('replaces action widgets when another review reuses identical hunk bounds', () => {
    function actionWidget(reviewId: string) {
      const state = EditorState.create({ doc: 'new', extensions: createReviewProjection({ reviewId, hunks: [{
        id: 'hunk', baseFrom: 0, baseTo: 3, proposedFrom: 0, proposedTo: 3,
        oldText: 'old', newText: 'new', from: 0, to: 3, status: 'pending'
      }] }, () => {}, () => {}) });
      let widget: WidgetType | undefined;
      for (const decoration of state.facet(EditorView.decorations)) {
        if (typeof decoration === 'function') continue;
        for (let cursor = decoration.iter(); cursor.value; cursor.next()) {
          if (cursor.value.spec.widget && cursor.from === 3) widget = cursor.value.spec.widget;
        }
      }
      if (!widget) throw new Error('No proposal action widget rendered');
      return widget;
    }
    const original = actionWidget('original');
    expect(original.eq(actionWidget('original'))).toBe(true);
    expect(original.eq(actionWidget('replacement'))).toBe(false);
  });

});

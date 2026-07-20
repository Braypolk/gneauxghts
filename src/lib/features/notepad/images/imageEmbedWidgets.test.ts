import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  buildImageEmbedDecorations,
  selectionIntersectsImageEmbed
} from './imageEmbedWidgets';

function createView(doc: string, anchor: number, head = anchor) {
  // Headless stub: buildImageEmbedDecorations only reads state (and stores the
  // view reference on widgets — it does not mount DOM in this path).
  return {
    state: EditorState.create({
      doc,
      selection: { anchor, head }
    })
  } as EditorView;
}

describe('selectionIntersectsImageEmbed', () => {
  const ranges = [{ from: 10, to: 30 }];

  it('detects overlapping selection', () => {
    expect(selectionIntersectsImageEmbed({ from: 15, to: 15 }, ranges)).toBe(true);
    expect(selectionIntersectsImageEmbed({ from: 5, to: 12 }, ranges)).toBe(true);
  });

  it('ignores adjacent or distant selection', () => {
    expect(selectionIntersectsImageEmbed({ from: 10, to: 10 }, ranges)).toBe(false);
    expect(selectionIntersectsImageEmbed({ from: 30, to: 30 }, ranges)).toBe(false);
    expect(selectionIntersectsImageEmbed({ from: 0, to: 5 }, ranges)).toBe(false);
  });
});

describe('buildImageEmbedDecorations', () => {
  it('returns embed ranges even when selection hides the widget', () => {
    const doc = 'before ![[shot.png]] after';
    const from = doc.indexOf('![[');
    const to = doc.indexOf(']]') + 2;
    const view = createView(doc, from + 2);

    const built = buildImageEmbedDecorations(view, '/assets');
    expect(built.ranges).toEqual([{ from, to }]);
    expect(built.decorations.size).toBe(0);
  });

  it('builds decorations when selection is outside the embed', () => {
    const doc = 'before ![[shot.png]] after';
    const view = createView(doc, 0);

    const built = buildImageEmbedDecorations(view, '/assets');
    expect(built.ranges).toHaveLength(1);
    expect(built.decorations.size).toBeGreaterThan(0);
  });

  it('returns empty ranges when asset root is missing', () => {
    const view = createView('![[shot.png]]', 0);
    const built = buildImageEmbedDecorations(view, null);
    expect(built.ranges).toEqual([]);
    expect(built.decorations.size).toBe(0);
  });
});

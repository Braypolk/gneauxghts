import { describe, expect, it } from 'vitest';
import { createCommandView } from './commandTestSupport';
import { createMarkdownLanguage } from '../markdown/markdownLanguage';
import { moveThroughLink } from './linkNavigation';

describe('link Tab navigation', () => {
  for (const markdown of [
    '[]()',
    '[label]()',
    '[label](https://example.com)',
    '[**label**](https://example.com/a_(b))',
    '[label](https://example.com "title")',
    'prefix [label](url) suffix',
    '[first](one) [second](two)',
    '[la\\]bel](url)'
  ]) {
    it(`moves from anywhere in the label or destination of ${markdown}`, () => {
      const open = markdown.lastIndexOf('[');
      const labelEnd = markdown.lastIndexOf('](');
      const close = markdown.lastIndexOf(')');
      for (const [start, end, target] of [
        [open + 1, labelEnd, close],
        [labelEnd + 2, close, close + 1]
      ]) {
        for (let position = start; position <= end; position++) {
          const { view, transactions } = createCommandView({
            doc: markdown,
            selection: { anchor: position },
            extensions: [createMarkdownLanguage()]
          });
          expect(moveThroughLink(view), `cursor at ${position}`).toBe(true);
          expect(view.state.selection.main.anchor).toBe(target);
          expect(view.state.selection.main.head).toBe(target);
          expect(view.state.doc.toString()).toBe(markdown);
          expect(transactions[0].docChanged).toBe(false);
        }
      }
    });

    it(`moves backward from anywhere in the destination of ${markdown} to the label's end`, () => {
      const labelEnd = markdown.lastIndexOf('](');
      const close = markdown.lastIndexOf(')');
      for (let position = labelEnd + 2; position <= close; position++) {
        const { view, transactions } = createCommandView({
          doc: markdown,
          selection: { anchor: position },
          extensions: [createMarkdownLanguage()]
        });
        expect(moveThroughLink(view, 'backward'), `cursor at ${position}`).toBe(true);
        expect(view.state.selection.main.anchor).toBe(labelEnd);
        expect(view.state.selection.main.head).toBe(labelEnd);
        expect(view.state.doc.toString()).toBe(markdown);
        expect(transactions[0].docChanged).toBe(false);
      }
    });
  }

  it.each([
    ['plain text', 3, 3],
    ['[label](url)', 0, 0],
    ['[label](url)', 7, 7],
    ['[label](url)', 12, 12],
    ['[label](url)', 1, 6],
    ['`[label](url)`', 3, 3],
    ['```\n[label](url)\n```', 6, 6],
    ['![label](url)', 3, 3],
    ['[[Note]]', 3, 3],
    ['[label][ref]\n\n[ref]: url', 3, 3],
    ['[label](unfinished', 3, 3]
  ])('leaves ordinary Tab handling available in %s at %i–%i', (markdown, anchor, head) => {
    const { view, transactions } = createCommandView({
      doc: markdown,
      selection: { anchor, head },
      extensions: [createMarkdownLanguage()]
    });
    expect(moveThroughLink(view)).toBe(false);
    expect(moveThroughLink(view, 'backward')).toBe(false);
    expect(transactions).toHaveLength(0);
  });

  it('leaves Shift+Tab in the label available for ordinary outdent', () => {
    const { view, transactions } = createCommandView({
      doc: '[label](url)',
      selection: { anchor: 6 },
      extensions: [createMarkdownLanguage()]
    });
    expect(moveThroughLink(view, 'backward')).toBe(false);
    expect(transactions).toHaveLength(0);
  });
});

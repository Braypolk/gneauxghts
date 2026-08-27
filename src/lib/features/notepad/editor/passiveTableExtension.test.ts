import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  collectPassiveTableRanges,
  collectPassiveTableLineSpecs,
  isMarkdownTableDelimiterLine,
  nextTableRowScrollLeft
} from './passiveTableExtension';

function ranges(source: string) {
  return collectPassiveTableRanges(EditorState.create({ doc: source }).doc);
}

describe('passive Markdown table ranges', () => {
  it('groups a header, delimiter, and any number of body rows', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const [table] = ranges(source);

    expect(table).toEqual({
      headerFrom: 0,
      delimiterFrom: source.indexOf('| ---'),
      bodyFroms: [source.indexOf('| 1'), source.indexOf('| 3')],
      endFrom: source.indexOf('| 3')
    });
  });

  it('keeps a header-only table stable', () => {
    const source = '| A | B |\n| --- | --- |';
    const [table] = ranges(source);

    expect(table.bodyFroms).toEqual([]);
    expect(table.endFrom).toBe(table.delimiterFrom);
    expect(
      collectPassiveTableLineSpecs(EditorState.create({ doc: source }).doc).map(
        (spec) => spec.className
      )
    ).toEqual([
      'gn-markdown-table-line gn-markdown-table-header gn-markdown-table-line-start',
      'gn-markdown-table-line gn-markdown-table-delimiter gn-markdown-table-line-end'
    ]);
  });

  it('separates adjacent and blank-separated tables', () => {
    const adjacent =
      '| A | B |\n| --- | --- |\n| C | D |\n| --- | --- |';
    expect(ranges(adjacent)).toHaveLength(2);

    const separate = `${adjacent}\n\n| E | F |\n| --- | --- |\n| 1 | 2 |`;
    expect(ranges(separate)).toHaveLength(3);
    expect(
      new Set(
        collectPassiveTableLineSpecs(
          EditorState.create({ doc: separate }).doc
        ).map((spec) => spec.groupId)
      )
    ).toEqual(new Set(['0', '1', '2']));
  });

  it('requires a real delimiter rather than ordinary pipe prose', () => {
    expect(isMarkdownTableDelimiterLine('| --- | :---: |')).toBe(true);
    expect(isMarkdownTableDelimiterLine('| value | prose |')).toBe(false);
    expect(ranges('ordinary | prose\nnot | a table')).toEqual([]);
  });
});

describe('passive table caret scrolling', () => {
  it('scrolls right and left only when the caret leaves the visible row', () => {
    expect(
      nextTableRowScrollLeft({
        scrollLeft: 20,
        rowLeft: 100,
        rowRight: 300,
        caretLeft: 320
      })
    ).toBe(64);
    expect(
      nextTableRowScrollLeft({
        scrollLeft: 80,
        rowLeft: 100,
        rowRight: 300,
        caretLeft: 90
      })
    ).toBe(46);
    expect(
      nextTableRowScrollLeft({
        scrollLeft: 20,
        rowLeft: 100,
        rowRight: 300,
        caretLeft: 180
      })
    ).toBe(20);
  });

  it('never requests a negative scroll offset in narrow panes', () => {
    expect(
      nextTableRowScrollLeft({
        scrollLeft: 4,
        rowLeft: 100,
        rowRight: 140,
        caretLeft: 20
      })
    ).toBe(0);
  });
});

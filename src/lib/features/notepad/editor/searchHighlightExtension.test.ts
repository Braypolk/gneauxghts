import { describe, expect, it } from 'vitest';

import { searchMatchDecorationClass } from './searchHighlightExtension';

describe('search highlight selection layering', () => {
  it('detects partial and multiline-style selection overlap', () => {
    expect(
      searchMatchDecorationClass(
        { from: 10, to: 15 },
        [{ from: 5, to: 12, empty: false }]
      )
    ).toEqual({ selected: false, overlaps: true });
  });

  it('retains exact-match identity while yielding fill to selection', () => {
    expect(
      searchMatchDecorationClass(
        { from: 10, to: 15 },
        [{ from: 10, to: 15, empty: false }]
      )
    ).toEqual({ selected: true, overlaps: true });
  });

  it('does not treat a caret as a painted selection', () => {
    expect(
      searchMatchDecorationClass(
        { from: 10, to: 15 },
        [{ from: 12, to: 12, empty: true }]
      )
    ).toEqual({ selected: false, overlaps: false });
  });
});

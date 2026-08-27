import { describe, expect, it } from 'vitest';

import { computeBlockExtentGeometry } from './blockHandleExtension';

describe('hovered block extent geometry', () => {
  it('spans single-line and multiline blocks without changing width', () => {
    expect(
      computeBlockExtentGeometry({
        blockTop: 100,
        blockBottom: 124,
        viewportTop: 20,
        viewportBottom: 500,
        left: 80
      })
    ).toEqual({ top: 100, left: 80, height: 24 });
    expect(
      computeBlockExtentGeometry({
        blockTop: 100,
        blockBottom: 260,
        viewportTop: 20,
        viewportBottom: 500,
        left: 80
      })
    ).toEqual({ top: 100, left: 80, height: 160 });
  });

  it('clips wrapped or partially visible blocks to the viewport', () => {
    expect(
      computeBlockExtentGeometry({
        blockTop: -40,
        blockBottom: 260,
        viewportTop: 20,
        viewportBottom: 180,
        left: 80.4
      })
    ).toEqual({ top: 20, left: 80, height: 160 });
  });

  it('hides an offscreen or invalid block', () => {
    expect(
      computeBlockExtentGeometry({
        blockTop: 220,
        blockBottom: 260,
        viewportTop: 20,
        viewportBottom: 180,
        left: 80
      })
    ).toBeNull();
    expect(
      computeBlockExtentGeometry({
        blockTop: Number.NaN,
        blockBottom: 260,
        viewportTop: 20,
        viewportBottom: 180,
        left: 80
      })
    ).toBeNull();
  });
});

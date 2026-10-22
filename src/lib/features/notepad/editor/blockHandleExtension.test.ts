import { describe, expect, it } from 'vitest';

import { computeBlockDragScrollVelocity, computeBlockExtentGeometry } from './blockHandleExtension';

describe('block drag edge scrolling', () => {
  it('keeps the center still and accelerates proportionally toward both edges', () => {
    expect(computeBlockDragScrollVelocity(300, 100, 500)).toBe(0);
    expect(computeBlockDragScrollVelocity(136, 100, 500)).toBe(-450);
    expect(computeBlockDragScrollVelocity(464, 100, 500)).toBe(450);
    expect(computeBlockDragScrollVelocity(100, 100, 500)).toBe(-900);
    expect(computeBlockDragScrollVelocity(500, 100, 500)).toBe(900);
  });

  it('bounds speed outside the viewport and scales the edge band for short panes', () => {
    expect(computeBlockDragScrollVelocity(-1000, 100, 500)).toBe(-900);
    expect(computeBlockDragScrollVelocity(1000, 100, 500)).toBe(900);
    expect(computeBlockDragScrollVelocity(110, 100, 180)).toBe(-450);
    expect(computeBlockDragScrollVelocity(140, 100, 180)).toBe(0);
    expect(computeBlockDragScrollVelocity(100, 100, 100)).toBe(0);
    expect(computeBlockDragScrollVelocity(Number.NaN, 100, 500)).toBe(0);
  });
});

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

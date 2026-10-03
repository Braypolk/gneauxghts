import { describe, expect, it } from 'vitest';
import { boundedPan, viewerFit } from './imageViewerModel';
describe('viewer geometry', () => {
  it('fits large images without enlarging small images', () => {
    expect(viewerFit(2000, 1000, 1000, 600)).toBe(.5);
    expect(viewerFit(100, 100, 1000, 600)).toBe(1);
  });
  it('clamps both axes and centers axes smaller than the viewport', () => {
    expect(boundedPan(900, -900, 1200, 900, 1000, 600)).toEqual({ x: 100, y: -150 });
    expect(boundedPan(20, 30, 100, 100, 1000, 600)).toEqual({ x: 0, y: 0 });
  });
});

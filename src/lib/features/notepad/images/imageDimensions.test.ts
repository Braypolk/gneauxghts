import { describe, expect, it } from 'vitest';
import { createImageDimensionCache } from './imageDimensions';

describe('image size hints', () => {
  it('separates vaults and invalidates hints when the resolved asset version changes', () => {
    let root = 'one';
    const hints = createImageDimensionCache(() => root);
    hints.set('photo.png', 'asset://photo?v=1', { width: 1200, height: 800 });
    expect(hints.get('photo.png')).toEqual({ width: 1200, height: 800 });
    root = 'two'; expect(hints.get('photo.png')).toBeUndefined();
    root = 'one'; expect(hints.get('photo.png', 'asset://photo?v=2')).toBeUndefined();
    expect(hints.get('photo.png')).toBeUndefined();
  });

  it('bounds retained hints, ignores invalid dimensions and clears on disposal', () => {
    const hints = createImageDimensionCache(() => 'vault', 2);
    hints.set('a', 'a', { width: 10, height: 20 });
    hints.set('b', 'b', { width: 20, height: 10 });
    hints.get('a');
    hints.set('c', 'c', { width: 30, height: 10 });
    expect(hints.get('b')).toBeUndefined();
    for (const height of [0, -1, NaN, Infinity]) hints.set('a', 'a', { width: 10, height });
    expect(hints.get('a')).toEqual({ width: 10, height: 20 });
    hints.clear(); expect(hints.get('a')).toBeUndefined();
  });
});

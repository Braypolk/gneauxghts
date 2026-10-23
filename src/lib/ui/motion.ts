/** Match a CSS cubic-bezier curve in frame-driven and Svelte animations. */
export function cubicBezierProgress(
  elapsed: number,
  [x1, y1, x2, y2]: readonly [number, number, number, number]
): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= 1) return 1;
  let low = 0, high = 1;
  for (let index = 0; index < 20; index++) {
    const t = (low + high) / 2, inverse = 1 - t;
    const x = 3 * inverse * inverse * t * x1 + 3 * inverse * t * t * x2 + t * t * t;
    if (x < elapsed) low = t;
    else high = t;
  }
  const t = (low + high) / 2, inverse = 1 - t;
  return 3 * inverse * inverse * t * y1 + 3 * inverse * t * t * y2 + t * t * t;
}

/** Explicit navigation may scroll smoothly; reduced motion always settles immediately. */
export function navigationScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}

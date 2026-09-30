/** Explicit navigation may scroll smoothly; reduced motion always settles immediately. */
export function navigationScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}

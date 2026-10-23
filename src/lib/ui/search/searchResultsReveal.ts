import type { TransitionConfig } from 'svelte/transition';
import { cubicBezierProgress } from '#lib/ui/motion.js';
import { searchExpansionBezier } from '#lib/ui/search/searchMotion.js';

/** Clip the panel from its existing base without changing its text layout. */
export function searchResultsReveal(node: HTMLElement) {
  return ({ direction }: { direction: 'in' | 'out' } = { direction: 'in' }): TransitionConfig => {
    const dock = node.closest<HTMLElement>('.workspace-input-dock');
    const shell = node.closest<HTMLElement>('.shared-search-bar-shell') ?? dock?.querySelector<HTMLElement>('.shared-search-bar-shell');
    // Loading/results replacements reveal the new panel without retaining the old one.
    if (direction === 'out' && shell?.dataset.searchOpen !== 'false') {
      return { duration: 0 };
    }
    const duration = direction === 'out' ? 275 : 350;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Search and Related reveal immediately, alongside Search expansion. Only
    // entry from the chat composer waits for the input surfaces to exchange.
    // On dismissal, retain the displayed position while the bar moves back.
    const holdPosition = direction === 'out' && dock?.hasAttribute('data-dock-motion');
    const rect = holdPosition && shell ? node.getBoundingClientRect() : null;
    // The overlay belongs to the shared body, not Search's bordered input shell.
    const center = rect && dock ? rect.left + rect.width / 2 - dock.getBoundingClientRect().left - dock.clientLeft : 0;
    const position = rect ? `left:calc(${center}px - var(--dock-body-x));width:${rect.width}px;height:${rect.height}px;` : '';
    return {
      duration: reduced ? 0 : duration,
      delay: reduced || direction === 'out' || !dock?.hasAttribute('data-popup-delay') ? 0
        : Math.max(0, Number(dock?.dataset.dockResultsReadyAt ?? 0) - performance.now()),
      // Use the same CSS curve as the bar for both directions and interrupted transitions.
      easing: (elapsed) => cubicBezierProgress(elapsed, searchExpansionBezier),
      css: (t, inverse) => `${position}clip-path: inset(calc(${inverse * 100}% - ${t * 24}px) -24px -24px);`
    };
  };
}

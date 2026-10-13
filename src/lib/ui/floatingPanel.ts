import { autoUpdate, computePosition, flip, offset, shift, size, type ReferenceElement } from '@floating-ui/dom';

export const hiddenFloatingPanelStyle = 'position: fixed; left: 0; top: 0; visibility: hidden;';

/** Shared anchoring, collision handling, and scroll/resize tracking for floating panels. */
export function positionFloatingPanel(
  reference: ReferenceElement,
  panel: HTMLElement,
  setStyle: (style: string) => void,
  options: {
    boundsElement?: HTMLElement | null;
    resize?: (availableHeight: number) => void;
  } = {}
): () => void {
  let disposed = false;
  const update = async () => {
    const style = getComputedStyle(document.documentElement);
    const inset = (edge: string) => Math.max(16, parseFloat(style.getPropertyValue(`--app-safe-area-${edge}`)) || 0);
    const collision = { padding: { top: inset('top'), right: inset('right'), bottom: inset('bottom'), left: inset('left') }, ...(options.boundsElement ? { boundary: options.boundsElement } : {}) };
    const { x, y } = await computePosition(reference, panel, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [
        offset(10),
        flip({ ...collision, fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
        shift(collision),
        size({ ...collision, apply({ availableHeight, availableWidth }) {
          if (disposed) return;
          const height = Math.max(0, Math.floor(availableHeight));
          panel.style.maxWidth = `${Math.max(0, Math.floor(availableWidth))}px`;
          if (options.resize) options.resize(height);
          // A consumer can reserve local chrome in addition to collision bounds.
          else panel.style.maxHeight = `min(${height}px, var(--floating-panel-max-height, 100dvh))`;
        } })
      ]
    });
    if (!disposed) {
      const maxHeight = options.resize ? '' : ` max-height: ${panel.style.maxHeight};`;
      setStyle(`position: fixed; left: ${Math.round(x)}px; top: ${Math.round(y)}px; visibility: visible; max-width: ${panel.style.maxWidth};${maxHeight}`);
    }
  };
  const cleanup = autoUpdate(reference, panel, () => { void update(); });
  return () => { disposed = true; cleanup(); };
}

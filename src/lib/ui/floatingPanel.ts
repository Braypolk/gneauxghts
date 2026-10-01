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
  const collision = { padding: 16, ...(options.boundsElement ? { boundary: options.boundsElement } : {}) };
  const update = async () => {
    const { x, y } = await computePosition(reference, panel, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [
        offset(10),
        flip({ ...collision, fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
        shift(collision),
        size({ ...collision, apply({ availableHeight }) {
          if (disposed) return;
          const height = Math.max(0, Math.floor(availableHeight));
          if (options.resize) options.resize(height);
          else panel.style.maxHeight = `${height}px`;
        } })
      ]
    });
    if (!disposed) {
      const maxHeight = options.resize ? '' : ` max-height: ${panel.style.maxHeight};`;
      setStyle(`position: fixed; left: ${Math.round(x)}px; top: ${Math.round(y)}px; visibility: visible;${maxHeight}`);
    }
  };
  const cleanup = autoUpdate(reference, panel, () => { void update(); });
  return () => { disposed = true; cleanup(); };
}

/** Keep a stable outer frame for both inputs; the visible bar animates inside
 * it. Reading clearance and consumers of the frame share the same geometry. */
export function workspaceDockInset(node: HTMLElement) {
  const workspace = node.closest<HTMLElement>('.notepad-shell');
  const bar = node.firstElementChild as HTMLElement | null;
  let previous: number | undefined;
  function measure() {
    const dock = node.querySelector<HTMLElement>('[data-input-dock-mode]');
    const clearance = Math.max(Number(dock?.dataset.dockClearance ?? 0),
      Number(dock?.dataset.dockReadingClearance ?? 0));
    let height = bar?.getBoundingClientRect().height ?? 0;
    const row = dock?.closest<HTMLElement>('.search-dock-row');
    if (dock && row && clearance > 0) {
      const bodyHeight = parseFloat(getComputedStyle(dock).getPropertyValue('--dock-body-height'));
      const inset = dock.getBoundingClientRect().height - bodyHeight;
      const style = getComputedStyle(row);
      // Use the larger input plus chrome, independent of the animated row.
      // The frame must never measure its own previously reserved height.
      height = Math.max(parseFloat(style.minHeight),
        clearance + inset + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
    }
    height = Math.ceil(height);
    if (height === previous) return;
    previous = height;
    node.style.height = `${height}px`;
    workspace?.style.setProperty('--workspace-dock-height', `${height}px`);
  }
  measure();
  const observer = new ResizeObserver(measure);
  // Observe the intrinsic bar, since the frame deliberately stays fixed.
  if (bar) observer.observe(bar);
  const motion = new MutationObserver(measure);
  motion.observe(node, { subtree: true, attributes: true,
    attributeFilter: ['data-dock-clearance', 'data-dock-reading-clearance'] });
  return {
    destroy() {
      observer.disconnect();
      motion.disconnect();
      node.style.removeProperty('height');
      workspace?.style.removeProperty('--workspace-dock-height');
    }
  };
}

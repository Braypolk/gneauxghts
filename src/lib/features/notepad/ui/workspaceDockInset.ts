/** Reserve the expanded input's height in both chat modes so switching to the
 * shorter search bar never changes the reading surface's scroll extent. */
export function workspaceDockInset(node: HTMLElement) {
  const workspace = node.closest<HTMLElement>('.notepad-shell');
  let previous: number | undefined;
  function measure() {
    const dock = node.querySelector<HTMLElement>('[data-input-dock-mode]');
    const clearance = Math.max(Number(dock?.dataset.dockClearance ?? 0),
      Number(dock?.dataset.dockReadingClearance ?? 0));
    let height = node.getBoundingClientRect().height;
    const row = dock?.parentElement;
    if (dock && row && clearance > 0) {
      const bodyHeight = parseFloat(getComputedStyle(dock).getPropertyValue('--dock-body-height'));
      const inset = dock.getBoundingClientRect().height - bodyHeight;
      const style = getComputedStyle(row);
      // Project the row at the expanded height. Subtracting the current body
      // from the row alone would count its minimum-height slack as extra chrome
      // when search is compact, causing another jump during the handoff.
      const expandedRowHeight = Math.max(parseFloat(style.minHeight),
        clearance + inset + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
      height += expandedRowHeight - row.getBoundingClientRect().height;
    }
    height = Math.ceil(height);
    if (height === previous) return;
    previous = height;
    workspace?.style.setProperty('--workspace-dock-height', `${height}px`);
  }
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(node);
  const motion = new MutationObserver(measure);
  motion.observe(node, { subtree: true, attributes: true,
    attributeFilter: ['data-dock-clearance', 'data-dock-reading-clearance'] });
  return {
    destroy() {
      observer.disconnect();
      motion.disconnect();
      workspace?.style.removeProperty('--workspace-dock-height');
    }
  };
}

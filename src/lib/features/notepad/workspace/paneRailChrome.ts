import { tick } from 'svelte';

/** Share the measured header clearance across retained rails, including the
 * taller phone header. This is chrome geometry only; pane state stays owned by
 * the workspace. Observing both headers keeps the clearance stable on exchange.
 */
export function paneRailChrome(frame: HTMLElement, _kind: string) {
  const row = frame.closest('.notepad-pane')?.parentElement;
  let header: HTMLElement | null = null;
  let destroyed = false;
  function measure() {
    if (!row || destroyed) return;
    const top = row.getBoundingClientRect().top;
    const clearance = Math.max(0, ...[...row.querySelectorAll<HTMLElement>('.pane-header')]
      .map(node => node.getBoundingClientRect().bottom - top));
    row.style.setProperty('--pane-rail-header-clearance', `${Math.round(clearance)}px`);
  }
  const observer = new ResizeObserver(measure);
  async function observeHeader() {
    await tick();
    if (destroyed) return;
    observer.disconnect();
    header = frame.querySelector<HTMLElement>('.pane-header');
    if (header) observer.observe(header);
    measure();
  }
  void observeHeader();
  return {
    update(_kind: string) { void observeHeader(); },
    destroy() { destroyed = true; observer.disconnect(); }
  };
}

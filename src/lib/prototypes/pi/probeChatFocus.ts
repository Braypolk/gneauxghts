/** A retained mobile chat can exist behind an inert collapsed pane frame. */
export function visibleProbeControl(node: HTMLElement) {
  return !node.closest('[inert],[aria-hidden="true"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
}

export function visibleProbeChat() {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Thought partner chat"]')).find(visibleProbeControl);
}

export async function focusProbeChat<T extends { click(): void }>(input: {
  ready(): unknown;
  expandRail(): T | undefined;
  openHeader(): T | undefined;
  until<V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>>;
}) {
  if (input.ready()) return;
  const control = await input.until(() => {
    if (input.ready()) return { kind: 'ready' as const };
    const rail = input.expandRail();
    if (rail) return { kind: 'rail' as const, node: rail };
    const header = input.openHeader();
    return header ? { kind: 'header' as const, node: header } : undefined;
  }, 'visible normal chat expansion control');
  if (control.kind !== 'ready') control.node.click();
  await input.until(input.ready, 'visible non-inert normal chat panel');
}

/** Invoke normal pane controls; do not reveal collapsed frames by mutating CSS. */
export function openVisibleProbeChat(until: <V>(read: () => V | Promise<V>, label: string) => Promise<NonNullable<V>>) {
  const enabledVisible = (node: HTMLButtonElement) => !node.disabled && visibleProbeControl(node);
  return focusProbeChat({ until, ready: visibleProbeChat,
    expandRail: () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="workspace-pane"][data-pane-kind="chat"][data-pane-collapsed] button[aria-label^="Expand "]')).find(enabledVisible),
    openHeader: () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => enabledVisible(node) && ['Open thought partner', 'Open thought partner in this pane'].includes(node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '')) });
}

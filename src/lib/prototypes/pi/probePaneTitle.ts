/** Compact workspace headers move the same title input into the shared mobile
 * slot. Its sole owner is the pane that no longer retains its local title.
 * An unmounted pane shell must make ownership ambiguous, never borrow a title. */
export function probePaneTitle(pane: HTMLElement | null | undefined, kind: 'chat' | 'editor') {
  if (!pane) return undefined;
  const selector = kind === 'chat' ? '[aria-label="Chat title"]' : '[data-testid="note-title"]';
  const local = pane.querySelector<HTMLInputElement>(selector);
  if (local) return local;
  const titles = Array.from(document.querySelectorAll<HTMLInputElement>(`.mobile-workspace-title-slot ${selector}`));
  if (titles.length !== 1) return undefined;
  const owners = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="workspace-pane"][data-pane-kind="${kind}"]`))
    .filter(candidate => !candidate.querySelector(selector));
  return owners.length === 1 && owners[0] === pane ? titles[0] : undefined;
}

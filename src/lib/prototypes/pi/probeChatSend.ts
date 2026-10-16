import { visibleProbeControl } from './probeChatFocus';

const visible = (node: HTMLElement) => !node.closest('[hidden]') && visibleProbeControl(node);

export function probeChatPane(title?: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"][data-pane-kind="chat"]'))
    .find(pane => visible(pane) && (title === undefined || pane.querySelector<HTMLInputElement>('[aria-label="Chat title"]')?.value === title));
}

/** The inactive pane retains its composer under a hidden slot. Normal header
 * focus moves that same DOM surface into the shared dock; never substitute a
 * different pane's visible composer while that move is pending. */
export async function focusProbeChatComposer(pane: HTMLElement, until: <T>(read: () => T | Promise<T>, label: string) => Promise<NonNullable<T>>) {
  const title = pane.querySelector<HTMLInputElement>('[aria-label="Chat title"]');
  if (!title || !visible(title)) throw new Error('Requested chat pane has no visible normal title control');
  const retained = pane.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
  // If its composer is already portaled, capture the sole visible dock surface
  // before focusing. Multiple visible surfaces cannot establish its owner.
  const docked = retained ? undefined : Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]'))
    .filter(node => visible(node) && !node.closest('[data-testid="workspace-pane"]'));
  const composer = retained ?? (docked?.length === 1 ? docked[0] : undefined);
  if (!composer) throw new Error('Requested chat pane has no unambiguous retained composer');
  title.focus();
  return until(() => composer.isConnected && !composer.disabled && visible(composer) ? composer : undefined, 'requested chat composer moves into visible normal dock');
}

export function probeComposerSend(composer: HTMLTextAreaElement) {
  const control = composer.closest('.chat-composer-surface')?.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
  return control && !control.disabled && visible(control) ? control : undefined;
}

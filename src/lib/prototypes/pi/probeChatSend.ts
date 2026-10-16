import { visibleProbeControl } from './probeChatFocus';
import { probePaneTitle } from './probePaneTitle';

const visible = (node: HTMLElement) => !node.closest('[hidden]') && visibleProbeControl(node);

export function probeChatPane(title?: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"][data-pane-kind="chat"]'))
    .find(pane => {
      const field = probePaneTitle(pane, 'chat');
      return visible(pane) && field && visible(field) && (title === undefined || field.value === title);
    });
}

/** The inactive pane retains its composer under a hidden slot. Normal header
 * focus moves that same DOM surface into the shared dock; never substitute a
 * different pane's visible composer while that move is pending. */
export async function focusProbeChatComposer(pane: HTMLElement, until: <T>(read: () => T | Promise<T>, label: string) => Promise<NonNullable<T>>) {
  const title = await until(() => {
    const field = probePaneTitle(pane, 'chat');
    return visible(pane) && field && visible(field) ? field : undefined;
  }, 'requested chat pane has its visible normal title control');
  const retained = pane.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
  // A portaled surface may be hidden while the dock shows search. Capture the
  // sole normal chat-slot surface even then; its absence from the requested
  // pane distinguishes it from every other pane's locally retained composer.
  const docked = retained ? undefined : Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]'))
    .filter(node => node.closest('.workspace-chat-slot') && !node.closest('[data-testid="workspace-pane"]'));
  const composer = retained ?? (docked?.length === 1 ? docked[0] : undefined);
  if (!composer) throw new Error('Requested chat pane has no unambiguous retained composer');
  title.focus();
  if (document.activeElement !== title) throw new Error('Requested chat title did not receive normal focus');
  let expanded = false;
  return until(() => {
    if (composer.isConnected && !composer.disabled && visible(composer)) return composer;
    // Wait for this exact composer's normal relocation before using the dock
    // control: clicking the old pane's Expand control could reactivate it.
    const dock = composer.closest('.workspace-chat-slot')?.closest('[data-input-dock-mode]');
    const expand = dock?.querySelector<HTMLButtonElement>('button[aria-label="Expand chat input"]');
    if (!expanded && composer.isConnected && expand && !expand.disabled && visible(expand)) {
      expanded = true; expand.click();
    }
    return undefined;
  }, 'requested chat composer moves into visible normal dock');
}

export function probeChatSendDiagnostics() {
  return {
    documentVisibility: document.visibilityState,
    documentFocused: document.hasFocus(),
    panes: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"][data-pane-kind="chat"]')).slice(0, 6)
      .map(pane => ({ paneId: pane.dataset.paneId, title: probePaneTitle(pane, 'chat')?.value,
        retainedComposer: Boolean(pane.querySelector('textarea[aria-label="Message"]')), visible: visible(pane),
        history: Array.from(pane.querySelectorAll<HTMLElement>('[role="log"]')).map(log => ({
          phase: log.dataset.chatLoadingPhase, rendered: log.dataset.chatRenderedMessages,
          total: log.dataset.chatTotalMessages, busy: log.getAttribute('aria-busy')
        })) })),
    composers: Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]')).slice(0, 6)
      .map(node => ({ paneId: node.closest<HTMLElement>('[data-testid="workspace-pane"]')?.dataset.paneId,
        inDock: Boolean(node.closest('.workspace-chat-slot')), dockMode: node.closest<HTMLElement>('[data-input-dock-mode]')?.dataset.inputDockMode,
        visible: visible(node), disabled: node.disabled, connected: node.isConnected, focused: document.activeElement === node })),
  };
}

export function probeComposerSend(composer: HTMLTextAreaElement) {
  const control = composer.closest('.chat-composer-surface')?.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
  return control && !control.disabled && visible(control) ? control : undefined;
}

import { visibleProbeControl } from './probeChatFocus';

const visible = (node: HTMLElement) => node.isConnected && !node.closest('[hidden]') && visibleProbeControl(node);
// Native Tauri commands reject strings. ChatMessageList's normal catch maps
// those to the first exact message; the remaining strings are native refusals.
const refusalMessages = new Set(['Unable to open the referenced note.', 'Source unavailable',
  'Passage changed before navigation', 'This passage changed or is unavailable. Refresh the answer to obtain current evidence.']);

/** Observe the exact normal source action, not hidden evidence controls or a
 * global alert. A visible refusal also needs independent API withholding and
 * unchanged retained editor ownership/content/selection before it is proof. */
export async function observeStaleProbeCitation(input: {
  messageId: string;
  citationIds: readonly string[];
  pane: HTMLElement;
  errorRoot: HTMLElement;
  change(): Promise<void>;
  unavailable(): Promise<boolean>;
  working(): unknown;
  until<V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>>;
}) {
  const { pane, errorRoot } = input;
  if (!visible(pane) || pane.dataset.paneKind !== 'chat' || !visible(errorRoot))
    throw new Error('Stale source requires its visible normal chat and composer');
  if (!input.citationIds.length) throw new Error('Stale source lacks exact issued citation identities');
  const workingBefore = input.working();
  const baseline = JSON.stringify(workingBefore);
  await input.change();
  const alerts = () => Array.from(errorRoot.querySelectorAll<HTMLElement>('[role="alert"]')).filter(visible)
    .map(node => ({ node, text: node.querySelector('span')?.textContent?.trim() ?? '' }));
  const priorAlerts = new Map(alerts().map(({ node, text }) => [node, text]));
  const observed = await input.until(() => {
    if (!visible(pane) || !visible(errorRoot)) return;
    const message = pane.querySelector<HTMLElement>(`[data-chat-message-id="${input.messageId}"]`);
    if (!message || !visible(message) || message.closest('[data-testid="workspace-pane"]') !== pane) return;
    const citation = Array.from(message.querySelectorAll<HTMLButtonElement>('button[data-chat-note-citation-id]'))
      .find(node => !node.disabled && visible(node) && input.citationIds.includes(node.dataset.chatNoteCitationId ?? ''));
    if (!citation) {
      const marker = Array.from(message.querySelectorAll<HTMLElement>('span[data-chat-selection-ignore]'))
        .find(value => visible(value) && value.textContent?.trim() === '[citation unavailable]');
      return marker ? { mode: 'withheld-source' as const, citationId: null } : undefined;
    }
    // No await between exact connected lookup and the normal delegated click.
    const citationId = citation.dataset.chatNoteCitationId!;
    citation.click();
    return { mode: 'navigation-error' as const, citationId };
  }, 'visible exact source or explicit unavailable marker after edit');
  const message = observed.mode === 'withheld-source' ? '[citation unavailable]' : await input.until(() => {
    if (!visible(pane) || !visible(errorRoot)) return;
    return alerts().find(({ node, text }) => priorAlerts.get(node) !== text && refusalMessages.has(text))?.text;
  }, 'new normal stale-source refusal in the owning composer');
  await input.until(input.unavailable, 'exact stale passage withheld by current conversation API');
  const workingAfter = input.working();
  if (JSON.stringify(workingAfter) !== baseline) throw new Error('Stale source navigation changed retained editor ownership, content or selection');
  if (!visible(pane) || !visible(errorRoot)) throw new Error('Stale source refusal lost its owning normal chat/composer');
  return { ...observed, message, apiWithheld: true, workingBefore, workingAfter };
}

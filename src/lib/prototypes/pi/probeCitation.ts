/** A canonical edit can replace the rendered message while native work awaits. */
export async function observeStaleProbeCitation(input: {
  messageId: string;
  change(): Promise<void>;
  unavailable?(): Promise<boolean>;
  root?: ParentNode;
  until<V>(read: () => V | Promise<V>, label: string): Promise<NonNullable<V>>;
}): Promise<{ mode: 'navigation-error' | 'withheld-source'; message: string }> {
  const root = input.root ?? document;
  await input.change();
  const observed = await input.until(() => {
    const message = root.querySelector(`[data-chat-message-id="${input.messageId}"]`);
    const citation = message?.querySelector<HTMLButtonElement>('button[data-slot="inline-citation"]');
    if (!citation?.isConnected) {
      const marker = message && Array.from(message.querySelectorAll('span[data-chat-selection-ignore]')).find(value => value.textContent?.trim() === '[citation unavailable]');
      return marker?.isConnected ? 'withheld-source' as const : undefined;
    }
    // No await between lookup and click: delegated handlers need the live tree.
    citation.click();
    return 'navigation-error' as const;
  }, 'connected source or explicit unavailable marker after edit');
  if (observed === 'withheld-source') {
    if (!await input.unavailable?.()) throw new Error('Unavailable source marker lacks API withholding proof');
    return { mode: observed, message: '[citation unavailable]' };
  }
  const message = await input.until(() => Array.from(root.querySelectorAll('[role="alert"]')).map(value => value.textContent?.trim()).find(value => value && /changed|stale|unavailable|refresh/i.test(value)), 'normal stale-source error');
  return { mode: observed, message };
}

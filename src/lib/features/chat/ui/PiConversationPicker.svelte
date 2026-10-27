<script lang="ts">
  import { tick } from 'svelte';
  import type { ConversationId } from '@earendil-works/pi-durable';
  import { Eraser, Undo2 } from '@lucide/svelte';
  import { canForgetConversation, chatErrorMessage, type PiConversationBinding } from './piConversationView';
  import { emptyChatActivity } from '../pi/activity';
  import ChatActivityDot from './ChatActivityDot.svelte';

  let { binding, onSelect }: { binding: PiConversationBinding; onSelect: (id: string | null) => void } = $props();
  const snapshot = $derived($binding);
  const activity = $derived(snapshot.activity ?? emptyChatActivity);
  const unavailable = $derived(snapshot.runtimeState !== 'open' || Boolean(snapshot.forgetting));
  let root = $state<HTMLDivElement | null>(null);
  let confirming = $state<ConversationId | null>(null);
  let pending = $state(false);
  let error = $state<string | null>(null);

  async function focusAction(id: ConversationId | undefined, top: number) {
    await tick();
    if (!root) return;
    const target = id ? root.querySelector<HTMLButtonElement>(`[data-forget-conversation-id="${id}"]`) : null;
    const available = target?.disabled ? root.querySelector<HTMLButtonElement>(`[data-conversation-id="${id}"]`) : target;
    (available ?? root.querySelector<HTMLButtonElement>('[data-new-conversation]'))?.focus({ preventScroll: true });
    root.scrollTop = top;
  }

  async function beginForget(id: ConversationId) {
    confirming = id; error = null;
    await tick();
    root?.querySelector<HTMLButtonElement>('[data-confirm-forget]')?.focus({ preventScroll: true });
  }

  async function forget(id: ConversationId) {
    if (pending) return;
    const rows = snapshot.conversations, index = rows.findIndex(row => row.id === id);
    const next = rows[index + 1]?.id ?? rows[index - 1]?.id;
    const top = root?.scrollTop ?? 0;
    pending = true; error = null;
    try {
      await binding.forget(id);
      confirming = null;
      pending = false;
      await focusAction(next, top);
    } catch (cause) { error = chatErrorMessage(cause); }
    finally { pending = false; }
  }

  async function undo() {
    const id = snapshot.recentlyForgotten, top = root?.scrollTop ?? 0;
    pending = true; error = null;
    try {
      await binding.unforget({ select: false });
      pending = false;
      await focusAction(id, top);
    } catch (cause) { error = chatErrorMessage(cause); }
    finally { pending = false; }
  }
</script>

<div class="pi-conversation-picker" role="menu" aria-label="Conversations" bind:this={root}>
  <button type="button" role="menuitem" data-new-conversation onclick={() => onSelect(null)}>New conversation</button>
  {#each snapshot.conversations as item (item.id)}
    {@const selected = item.id === snapshot.conversation?.id}
    {@const activityItem = $activity.conversations.get(item.id)}
    {@const blocked = unavailable || pending || (selected && !canForgetConversation(snapshot))}
    <div class="conversation-row" class:conversation-row--selected={selected} role="none">
      <button class="conversation-title" type="button" role="menuitem" data-conversation-id={item.id} aria-current={selected ? 'true' : undefined} title={item.title || 'Conversation'} onclick={() => onSelect(String(item.id))}>
        {item.title || 'Conversation'}{item.retired ? ' · Previous access' : ''}
      </button>
      <ChatActivityDot status={activityItem?.unread ? 'unread' : activityItem?.running ? 'running' : null} inline />
      {#if confirming === item.id}
        <button class="conversation-cancel" type="button" role="menuitem" disabled={pending} onclick={() => { confirming = null; void focusAction(item.id, root?.scrollTop ?? 0); }}>Cancel</button>
        <button class="conversation-forget" type="button" role="menuitem" data-confirm-forget aria-label={`Confirm forget ${item.title || 'conversation'}`} disabled={blocked} onclick={() => forget(item.id)}>{pending ? 'Forgetting…' : 'Forget'}</button>
      {:else}
        <button class="conversation-forget conversation-forget-icon" type="button" role="menuitem" data-forget-conversation-id={item.id} aria-label={`Forget ${item.title || 'conversation'}`} title={selected && !canForgetConversation(snapshot) ? 'Stop the response before forgetting this chat.' : 'Forget this chat'} disabled={blocked} onclick={() => beginForget(item.id)}><Eraser size={16} /></button>
      {/if}
    </div>
  {/each}
  {#if snapshot.listNext}<button type="button" role="menuitem" disabled={pending || unavailable} onclick={async () => { try { await binding.refreshList(true); } catch (cause) { error = chatErrorMessage(cause); } }}>More conversations</button>{/if}
  {#if snapshot.recentlyForgotten}
    <div class="conversation-notice" role="none"><span role="status">Chat forgotten.</span><button type="button" role="menuitem" class="conversation-undo" disabled={pending || unavailable} onclick={undo}><Undo2 size={14} />Undo</button></div>
  {/if}
  {#if error}<p class="conversation-error" role="alert">{error}</p>{/if}
</div>

<style>
  .pi-conversation-picker { position: absolute; top: var(--pane-header-block-size, 4rem); left: 1rem; z-index: 30; width: min(24rem, calc(100% - 2rem)); max-height: 60%; overflow: auto; overflow-anchor: none; padding: .375rem; border: 1px solid var(--border); border-radius: .7rem; background: var(--card); box-shadow: 0 8px 30px #0002; }
  button { display: flex; align-items: center; gap: .4rem; min-height: 36px; padding: .375rem .625rem; text-align: left; border-radius: .4rem; }
  button:hover:not(:disabled) { background: var(--accent); }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
  button:disabled { opacity: .4; }
  .conversation-row { display: flex; align-items: center; border-radius: .4rem; }
  .conversation-row:hover, .conversation-row:focus-within, .conversation-row--selected { background: var(--accent); }
  .conversation-title { flex: 1; min-width: 0; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conversation-forget, .conversation-cancel, .conversation-undo { flex-shrink: 0; font-size: .8rem; }
  .conversation-forget { color: var(--destructive); }
  .conversation-forget-icon { justify-content: center; width: 32px; min-height: 32px; padding: 0; margin-inline: .125rem; color: var(--muted-foreground); }
  .conversation-forget-icon:hover:not(:disabled), .conversation-forget-icon:focus-visible { color: var(--destructive); }
  .conversation-cancel { color: var(--muted-foreground); }
  .conversation-notice { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); margin-top: .25rem; padding: .25rem .75rem 0; color: var(--muted-foreground); font-size: .8rem; }
  .conversation-error { padding: .5rem .75rem; color: var(--destructive); font-size: .8rem; }
  @media (hover: hover) and (pointer: fine) and (min-width: 640px) {
    .conversation-forget-icon { opacity: 0; }
    .conversation-row:hover .conversation-forget-icon, .conversation-row:focus-within .conversation-forget-icon { opacity: 1; }
    .conversation-row:hover .conversation-forget-icon:disabled, .conversation-row:focus-within .conversation-forget-icon:disabled { opacity: .4; }
  }
  @media (hover: none), (pointer: coarse), (max-width: 639px) {
    button { min-height: 44px; }
    .conversation-forget-icon { width: 44px; }
  }
</style>

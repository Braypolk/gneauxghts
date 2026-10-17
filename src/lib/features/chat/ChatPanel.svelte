<script module lang="ts">
  export interface ComposerDock { slot: HTMLElement | null; expanded: boolean; onExpand: () => void; }
</script>
<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { PI_CONTEXT } from './pi/runtime';
  import { invoke } from '@tauri-apps/api/core';
  import { History, ArrowUp, Square, X, ShieldCheck, ShieldOff, ChevronDown, Check } from '@lucide/svelte';
  import PaneHeader from '$lib/ui/PaneHeader.svelte';
  import { mountInSlot } from '$lib/ui/mountInSlot';
  import { registerBackgroundSave } from '$lib/app/backgroundPersistence';
  import { createComposerDraftPersistence } from './ui/composerDraftPersistence';
  import { chatScrollPositionsFor, isNearLatestChatContent, positionInitialChatScroll } from './ui/chatMessageScroll';
  import { latestFailure, viewInbox, viewLive, type PiConversationBinding } from './ui/piConversationView';
  import PiMessage from './ui/PiMessage.svelte';
  import PiRuntimeDiagnostics from './ui/PiRuntimeDiagnostics.svelte';
  import PiModelSelector from './ui/PiModelSelector.svelte';
  import type { ChatSurfaceHandle } from './types';
  import './ui/chatPanel.css';
  let { binding, conversationId = null, autoInitialize = true, variant = 'pane', showConversationPicker = true, headerActions, headerSplit = false, mobileTitleActive = true, composerDock, draftSlot = null, onConversationChange, onSurfaceHandleChange, onOpenSource }: {
    binding: PiConversationBinding; conversationId?: string | null; autoInitialize?: boolean; variant?: 'pane' | 'focused' | 'inline'; showConversationPicker?: boolean; headerActions?: Snippet; headerSplit?: boolean; mobileTitleActive?: boolean; composerDock?: ComposerDock; draftSlot?: string | null;
    onConversationChange?: (id: string | null) => void; onSurfaceHandleChange?: (handle: ChatSurfaceHandle | null) => void; onOpenSource?: (authorityId: string, sourceId: string) => Promise<void>;
  } = $props();
  const snapshot = $derived($binding), live = $derived(viewLive(snapshot.view)), inbox = $derived(viewInbox(snapshot.view));
  const failure = $derived(latestFailure(snapshot.entries));
  const unanswered = $derived(snapshot.latestInput?.status === 'unanswered' && snapshot.latestInput.entry !== undefined ? snapshot.latestInput : undefined);
  const hasWork = $derived(Boolean(live.run || live.compactions?.length || inbox.items.length));
  const runtimeUnavailable = $derived(snapshot.runtimeState !== 'open');
  let draft = $state(''), titleDraft = $state(''), titleFocused = $state(false), submitting = $state(false);
  let menu = $state<'history' | 'access' | 'model' | 'reasoning' | null>(null), input = $state<HTMLTextAreaElement | null>(null), scrollRoot = $state<HTMLDivElement | null>(null), now = $state(Date.now());
  let composerSelection = 0, reported: string | null | undefined, renderedConversation: string | null | undefined, following = true;
  let lastInputId = untrack(() => conversationId);
  $effect(() => { if (conversationId !== lastInputId) { lastInputId = conversationId; if (snapshot.initialized && conversationId !== visibleId) { ++composerSelection; void binding.select(conversationId); } } });
  const positions = chatScrollPositionsFor(untrack(() => binding));
  const drafts = createComposerDraftPersistence({ getDraft: slot => invoke<string>('chat_get_composer_draft', { slot }), setDraft: (slot, body) => invoke<void>('chat_set_composer_draft', { slot, body }), applyDraft: body => { draft = body; }, onSaveError: error => binding.report(error) });
  const visibleId = $derived(snapshot.conversation ? String(snapshot.conversation.id) : null);
  const slot = $derived(visibleId ? `pi-conversation:${visibleId}` : draftSlot);
  $effect(() => { if (slot && !snapshot.loading && !submitting && slot !== drafts.peekSlot()) { draft = ''; void drafts.openSlot(slot); } });
  $effect(() => { drafts.record(draft); });
  $effect(() => { draft; const element = input; if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 240)}px`; } });
  $effect(() => { if (!titleFocused) titleDraft = snapshot.title; });
  $effect(() => { if (snapshot.initialized && !snapshot.loading && reported !== visibleId) { reported = visibleId; onConversationChange?.(visibleId); } });
  $effect(() => { if (!input || !onSurfaceHandleChange) return; const notify = onSurfaceHandleChange; notify({ focusComposer() { focusComposer(); return true; } }); return () => notify(null); });
  $effect(() => {
    if (snapshot.loading || !scrollRoot) return;
    const id = visibleId, root = scrollRoot;
    snapshot.entries; live.generation?.message;
    void tick().then(() => { if (id !== visibleId || !root.isConnected) return;
      if (renderedConversation !== id) { renderedConversation = id; const saved = id ? positions.get(id) : undefined; following = saved?.followingLatest ?? true; positionInitialChatScroll(root, null, saved); }
      else if (following) root.scrollTop = root.scrollHeight;
    });
  });
  // Record while mounted: teardown can measure an empty viewport and overwrite the reading position.
  function saveScroll() { if (!scrollRoot || snapshot.loading) return; following = isNearLatestChatContent(scrollRoot); if (visibleId) positions.set(visibleId, { scrollTop: scrollRoot.scrollTop, followingLatest: following }); }
  function focusComposer() { composerDock?.onExpand(); requestAnimationFrame(() => input?.focus({ preventScroll: true })); }
  async function action(work: () => Promise<unknown>) { try { await work(); } catch (error) { binding.report(error); } }
  async function submit() {
    if (runtimeUnavailable || submitting || !draft.trim()) return;
    const submitted = draft, selection = composerSelection; submitting = true;
    try { const submission = await binding.send(submitted); const admitted = await submission?.status(PI_CONTEXT); if (admitted && String(admitted.conversationId) === visibleId) { if (draft === submitted) draft = ''; if (slot) drafts.promoteSlot(slot, draft); } }
    catch (error) { if (selection === composerSelection && slot) drafts.promoteSlot(slot, draft); binding.report(error); } finally { submitting = false; }
  }
  function onComposerKeydown(event: KeyboardEvent) {
    // Touch Return edits the draft; Safari may report composition through keyCode.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229 || window.matchMedia('(any-pointer: coarse)').matches) return;
    event.preventDefault();
    void submit();
  }
  async function switchConversation(id: string | null) { ++composerSelection; saveScroll(); menu = null; await action(() => id ? binding.select(id) : binding.startNew()); }
  async function older() { if (!scrollRoot) return; const root = scrollRoot, height = root.scrollHeight, top = root.scrollTop; following = false; await action(binding.loadOlder); await tick(); root.scrollTop = top + root.scrollHeight - height; saveScroll(); }
  function openSource(sourceId: string) { const authority = snapshot.authority?.authorityId; if (!authority || !onOpenSource) { binding.report(new Error('This source is unavailable.')); return; } void action(() => onOpenSource(authority, sourceId)); }
  onMount(() => { if (autoInitialize) void binding.initialize(conversationId); const timer = setInterval(() => { now = Date.now(); }, 1000); const unregister = registerBackgroundSave(async () => { drafts.record(input?.value ?? draft); await drafts.flush(); }); return () => { clearInterval(timer); unregister(); drafts.dispose(); }; });
</script>
<svelte:window onkeydown={event => { if (event.key === 'Escape') menu = null; }} onpointerdown={event => { if (menu && menu !== 'history' && event.target instanceof Element && !event.target.closest('[data-chat-menu]')) menu = null; }} />
<section class={`chat-panel pane-header-host chat-panel--${variant} relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden`} class:chat-panel--docked={Boolean(composerDock)} aria-label="Thought partner chat" data-testid="pi-chat-panel">
  <PaneHeader titleText={snapshot.title} titlePlaceholder="New chat" right={headerActions} split={headerSplit} workspace={variant === 'pane'} {mobileTitleActive}>
    {#snippet title()}<input class="pane-header-title-input" aria-label="Conversation title" placeholder="New chat" disabled={runtimeUnavailable || !snapshot.conversation} bind:value={titleDraft} onfocus={() => titleFocused = true} onblur={() => { titleFocused = false; void action(() => binding.rename(titleDraft)); }} onkeydown={event => { if (event.key === 'Enter') input?.focus(); }} />{/snippet}
    {#snippet secondaryActions()}{#if showConversationPicker}<button type="button" class="pane-header-action" aria-label="Conversations" aria-expanded={menu === 'history'} onclick={() => menu = menu === 'history' ? null : 'history'}><History size={18} /></button>{/if}{/snippet}
  </PaneHeader>
  {#if menu === 'history'}<div class="pi-menu" role="menu" aria-label="Conversations">
    <button type="button" role="menuitem" onclick={() => switchConversation(null)}>New conversation</button>
    {#each snapshot.conversations as item (item.id)}<button type="button" role="menuitem" data-conversation-id={item.id} aria-current={String(item.id) === visibleId ? 'true' : undefined} onclick={() => switchConversation(String(item.id))}>{item.title || 'Conversation'}{item.retired ? ' · Previous access' : ''}</button>{/each}
    {#if snapshot.listNext}<button type="button" onclick={() => action(() => binding.refreshList(true))}>More conversations</button>{/if}
  </div>{/if}
  <div role="log" aria-label="Conversation messages" data-pane-content class="min-h-0 flex-1 overflow-y-auto" bind:this={scrollRoot} onscroll={saveScroll}><div class="chat-content-lane">
    {#if snapshot.loading}<p role="status">Loading conversation…</p>
    {:else if !snapshot.initialized}<p role="status">{snapshot.error ? 'Chat could not open.' : 'Opening chat…'}</p>
    {:else}
      {#if snapshot.historyNext}<button class="pi-subtle" type="button" onclick={older}>Load earlier messages</button>{/if}
      {#if snapshot.entries.length === 0 && !live.run}<p class="pi-empty">What are you thinking about?</p>{/if}
      {#each snapshot.entries as entry (entry.id)}{#each entry.model ?? [] as message, index (index)}{#if entry.kind !== 'pi.compaction' && entry.kind !== 'pi.reset'}<PiMessage {message} admitted={message.role === 'assistant'} onOpenSource={openSource} />{/if}{/each}{/each}
      {#if live.generation?.message}<PiMessage message={live.generation.message} streaming onOpenSource={openSource} />{/if}
      {#if live.run || live.compactions?.length}<div class="pi-activity" role="status" data-testid="pi-activity">
        <p>{snapshot.stopping ? 'Stopping…' : live.generation?.retry ? 'Waiting to retry model request' : live.generation?.deferred ? 'Waiting for model response' : live.tools?.some(tool => tool.status !== 'done') ? 'Running tools' : live.generation ? 'Generating response' : live.run ? 'Waiting' : 'Compacting conversation'}{snapshot.runStartedAt ? ` · ${Math.max(0, Math.floor((now - snapshot.runStartedAt) / 1000))}s` : ''}</p>
        {#each [...(live.tools ?? []), ...(live.nestedTools ?? [])] as tool (tool.callId)}<details><summary>{tool.name} · {tool.status}</summary>{#if tool.output}<pre>{tool.output}</pre>{/if}{#if tool.details}<pre>{JSON.stringify(tool.details, null, 2)}</pre>{/if}{#each tool.diagnostics ?? [] as diagnostic}<p>{diagnostic.severity}: {diagnostic.message}</p>{/each}</details>{/each}
        {#each live.compactions ?? [] as compact (compact.taskId)}<p>Compacting conversation{compact.blocking ? ' · response waiting' : ''}{compact.retry ? ' · waiting to retry' : ''}</p>{/each}
      </div>{/if}
      {#if live.compactionFailure}<p class="pi-error" role="status">Conversation compaction could not complete.</p>{/if}
      {#if unanswered && !failure && !live.run}<p class="pi-error" role="status">The response could not complete. Start a new attempt.</p>{/if}
      {#if (failure || unanswered) && !live.run}<button type="button" class="pi-subtle" data-testid="pi-new-attempt" disabled={runtimeUnavailable || snapshot.authority?.retired} onclick={() => action(binding.newAttempt)}>New attempt</button>{/if}
    {/if}
  </div></div>
  <div class="chat-panel-bottom shrink-0">
    <PiRuntimeDiagnostics diagnostics={snapshot.diagnostics} conversationId={snapshot.conversation?.id} />
    {#if snapshot.error}<div role="alert" class="pi-alert">{snapshot.error}<button type="button" aria-label="Dismiss chat error" onclick={binding.clearError}><X size={14} /></button>{#if !snapshot.initialized}<button type="button" onclick={() => binding.initialize(conversationId)}>Open chat again</button>{/if}</div>{/if}
    <div class="chat-composer-slot" class:chat-composer-slot--docked={Boolean(composerDock)} use:mountInSlot={composerDock?.slot} inert={composerDock && !composerDock.expanded}><div class="chat-composer-footer pb-3 pt-2 sm:pb-4"><div class="chat-content-lane"><div class="chat-composer-surface" class:chat-composer-surface--inline={variant === 'inline'}>
      {#if inbox.items.length}<div class="pi-queue" aria-label="Queued messages" data-testid="pi-queue">{#each inbox.items as item (item.id)}{#if item.mode !== 'write'}<div><span>{typeof item.content === 'string' ? item.content : item.content.filter(block => block.type === 'text').map(block => block.text).join('\n')}</span><button type="button" aria-label="Withdraw queued message" disabled={runtimeUnavailable} onclick={() => action(() => binding.withdraw(item.id))}><X size={14} /></button></div>{/if}{/each}</div>{/if}
      <textarea bind:this={input} bind:value={draft} class="chat-composer-input" aria-label="Message" placeholder="What are you thinking about?" rows="1" enterkeyhint="enter" disabled={runtimeUnavailable || !snapshot.initialized || snapshot.loading || snapshot.authority?.retired} onfocus={() => composerDock?.onExpand()} onkeydown={onComposerKeydown}></textarea>
      <div class="chat-composer-toolbar">
        <div class="relative" data-chat-menu>
          <button type="button" class="chat-composer-chip chat-composer-access" aria-label="Vault access" aria-haspopup="menu" aria-expanded={menu === 'access'} disabled={runtimeUnavailable || !snapshot.initialized || snapshot.authority?.retired} onclick={() => menu = menu === 'access' ? null : 'access'}>
            {#if snapshot.read.mode === 'fullVault'}<ShieldCheck class="h-3.5 w-3.5 shrink-0" />{:else}<ShieldOff class="h-3.5 w-3.5 shrink-0" />{/if}
            <span class="chat-composer-access-label">{snapshot.read.mode === 'fullVault' ? 'Full vault' : snapshot.read.attachedNoteIds.length ? 'Limited vault' : 'No notes'}</span><ChevronDown class="h-3 w-3 shrink-0 opacity-60" />
          </button>
          {#if menu === 'access'}<div class="chat-menu chat-menu--up" role="menu" aria-label="Vault access choices">
            {#each [{ mode: 'fullVault' as const, label: 'Full vault' }, { mode: 'attachedNotesOnly' as const, label: 'No notes' }] as option}
              <button type="button" class="chat-menu-item w-full" role="menuitemradio" aria-checked={snapshot.read.mode === option.mode} onclick={() => { menu = null; void action(() => binding.changeRead({ mode: option.mode, attachedNoteIds: [] })); }}><span class="flex-1">{option.label}</span>{#if snapshot.read.mode === option.mode}<Check size={14} />{/if}</button>
            {/each}
          </div>{/if}
        </div>
        <div class="chat-composer-primary">
          <PiModelSelector {binding} disabled={runtimeUnavailable || !snapshot.initialized || hasWork || snapshot.authority?.retired} modelOpen={menu === 'model'} reasoningOpen={menu === 'reasoning'} onModelOpenChange={open => menu = open ? 'model' : null} onReasoningOpenChange={open => menu = open ? 'reasoning' : null} />
          {#if hasWork && draft.trim()}<button type="button" class="chat-icon-button" aria-label="Queue message" title="Queue message" data-testid="pi-send" disabled={runtimeUnavailable || submitting || !snapshot.initialized || snapshot.loading || snapshot.authority?.retired} onclick={submit}><ArrowUp class="h-4 w-4" /></button>{/if}
          <button type="button" class="chat-send-button" aria-label={hasWork ? 'Stop' : 'Send message'} data-chat-action={hasWork ? 'stop' : 'send'} data-testid={hasWork ? 'pi-stop' : 'pi-send'} disabled={runtimeUnavailable || (hasWork ? snapshot.stopping : submitting || !draft.trim() || !snapshot.initialized || snapshot.loading || snapshot.authority?.retired)} onclick={() => hasWork ? binding.stop() : submit()}>
            {#if hasWork}<Square class="h-3.5 w-3.5 fill-current" />{:else}<ArrowUp class="h-4 w-4" />{/if}
          </button>
        </div>
      </div>
    </div></div></div></div>
  </div>
</section>
<style>
  .pi-menu { position: absolute; top: 4rem; left: 1rem; z-index: 30; max-height: 60%; overflow: auto; padding: .5rem; border: 1px solid var(--border); border-radius: .7rem; background: var(--card); box-shadow: 0 8px 30px #0002; }
  .pi-menu button { display: block; text-align: left; width: 100%; padding: .5rem .75rem; }
  .pi-empty { margin-top: 3rem; text-align: center; color: var(--muted-foreground); }
  .pi-activity { margin-block: 1rem; color: var(--muted-foreground); font-size: .8rem; }
  .pi-activity pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  button:disabled { opacity: .4; }
  .pi-alert { display: flex; gap: .5rem; justify-content: space-between; padding: .5rem 1rem; font-size: .8rem; color: var(--destructive); }
  .pi-queue { font-size: .75rem; padding: .3rem; }
  .pi-queue > div { display: flex; gap: .5rem; align-items: center; justify-content: space-between; }
  .pi-subtle { font-size: .8rem; text-decoration: underline; color: var(--muted-foreground); }
  .pi-error { color: var(--destructive); font-size: .8rem; }
</style>

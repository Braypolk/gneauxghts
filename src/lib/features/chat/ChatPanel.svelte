<script module lang="ts">
  export interface ComposerDock { slot: HTMLElement | null; expanded: boolean; onExpand: () => void; }
</script>
<script lang="ts">
  import { keyboardShortcutMatchesEvent } from '#lib/keyboardShortcuts.svelte.js';

  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { PI_CONTEXT } from './pi/runtime';
  import { invoke } from '@tauri-apps/api/core';
  import { History, ArrowUp, Square, X, ShieldCheck, ShieldOff, ChevronDown, Check } from '@lucide/svelte';
  import PaneHeader from '#lib/ui/PaneHeader.svelte';
  import { mountInSlot } from '#lib/ui/mountInSlot.js';
  import { hiddenFloatingPanelStyle, positionFloatingPanel } from '#lib/ui/floatingPanel.js';
  import { registerBackgroundSave } from '#lib/app/backgroundPersistence.js';
  import { createComposerDraftPersistence } from './ui/composerDraftPersistence';
  import { chatScrollPositionsFor, createChatMessageScroll } from './ui/chatMessageScroll';
  import { latestFailure, viewInbox, viewLive, type PiConversationBinding } from './ui/piConversationView';
  import PiMessage from './ui/PiMessage.svelte';
  import PiActivityGroup from './ui/PiActivityGroup.svelte';
  import PiQueue from './ui/PiQueue.svelte';
  import { activityTranscript } from './ui/piActivity';
  import { generationProgress, fallbackProgress } from './ui/piProgress';
  import PiRuntimeDiagnostics from './ui/PiRuntimeDiagnostics.svelte';
  import PiModelSelector from './ui/PiModelSelector.svelte';
  import PiContextUsage from './ui/PiContextUsage.svelte';
  import PiConversationPicker from './ui/PiConversationPicker.svelte';
  import { writeGrantForDuration, withCreationPermission, withWriteFolders } from './pi/authority';
  import WriteFoldersField from './ui/WriteFoldersField.svelte';
  import PiEditReview from './ui/PiEditReview.svelte';
  import type { ChatSurfaceHandle } from './types';
  import './ui/chatPanel.css';
  import { activityDescription, emptyChatActivity, isCompletionDisplayed } from './pi/activity';
  import ChatActivityDot from './ui/ChatActivityDot.svelte';
  let { binding, conversationId = null, autoInitialize = true, visible = true, variant = 'pane', showConversationPicker = true, headerActions, headerSplit = false, mobileTitleActive = true, composerDock, draftSlot = null, onConversationChange, onSurfaceHandleChange, onOpenSource }: {
    binding: PiConversationBinding; conversationId?: string | null; autoInitialize?: boolean; visible?: boolean; variant?: 'pane' | 'focused' | 'inline'; showConversationPicker?: boolean; headerActions?: Snippet; headerSplit?: boolean; mobileTitleActive?: boolean; composerDock?: ComposerDock; draftSlot?: string | null;
    onConversationChange?: (id: string | null) => void; onSurfaceHandleChange?: (handle: ChatSurfaceHandle | null) => void; onOpenSource?: (authorityId: string, sourceId: string) => Promise<string | void>;
  } = $props();
  const snapshot = $derived($binding), live = $derived(viewLive(snapshot.view)), inbox = $derived(viewInbox(snapshot.view));
  const failure = $derived(latestFailure(snapshot.entries));
  const transcript = $derived(activityTranscript(snapshot.entries, live, snapshot.editOutcomes));
  const progress = $derived(fallbackProgress(live, snapshot.stopping));
  const generationStatus = $derived(snapshot.stopping ? undefined : generationProgress(live));
  const latestItem = $derived(transcript.at(-1));
  const progressInGroup = $derived(Boolean(progress && latestItem?.kind === 'activity' && latestItem.items.some(item => item.kind === 'tool') && generationStatus === progress));
  const unanswered = $derived(snapshot.latestInput?.status === 'unanswered' && snapshot.latestInput.entry !== undefined ? snapshot.latestInput : undefined);
  const stopped = $derived(unanswered?.reason === 'aborted');
  const hasWork = $derived(Boolean(live.run || live.compactions?.length || inbox.items.length));
  const activity = $derived(snapshot.activity ?? emptyChatActivity);
  let foreground = $state(false);
  $effect(() => {
    const id = snapshot.conversation?.id;
    const item = id === undefined ? undefined : $activity.conversations.get(id);
    if (!visible || !foreground || snapshot.loading || hasWork || !item?.unread || item.running) return;
    if (!isCompletionDisplayed(item.completion, snapshot.latestInput, snapshot.entries)) return;
    const owner = snapshot.activity;
    if (owner && id !== undefined) void owner.markRead(id, item.completed).catch(error => binding.report(error));
  });
  const runtimeUnavailable = $derived(snapshot.runtimeState !== 'open');
  const chatPending = $derived(snapshot.loading || (!snapshot.initialized && !snapshot.error));
  let draft = $state(''), titleDraft = $state(''), titleFocused = $state(false), submitting = $state(false);
  let menu = $state<'history' | 'access' | 'writeFolders' | 'model' | 'reasoning' | null>(null), input = $state<HTMLTextAreaElement | null>(null), scrollRoot = $state<HTMLDivElement | null>(null);
  let folderDraft = $state(''), folderSaving = $state(false), folderError = $state<string | null>(null);
  let accessButton = $state<HTMLButtonElement | null>(null), folderPanel = $state<HTMLDivElement | null>(null);
  let folderPanelStyle = $state(hiddenFloatingPanelStyle);
  let folderAuthority: { id: string; revision: number } | undefined;
  let composerSelection = 0, reported: string | null | undefined;
  // Successful source navigation is local feedback, never a retained chat error.
  let sourceNotice = $state<string | null>(null), sourceNavigation = 0;
  let scrollController: ReturnType<typeof createChatMessageScroll> | undefined;
  let lastInputId = untrack(() => conversationId);
  $effect(() => { if (conversationId !== lastInputId) { lastInputId = conversationId; if (snapshot.initialized && conversationId !== visibleId) { ++composerSelection; void binding.select(conversationId); } } });
  const positions = chatScrollPositionsFor(untrack(() => binding));
  const drafts = createComposerDraftPersistence({ getDraft: slot => invoke<string>('chat_get_composer_draft', { slot }), setDraft: (slot, body) => invoke<void>('chat_set_composer_draft', { slot, body }), applyDraft: body => { draft = body; }, onSaveError: error => binding.report(error) });
  const visibleId = $derived(snapshot.conversation ? String(snapshot.conversation.id) : null);
  $effect(() => { visibleId; sourceNotice = null; ++sourceNavigation; });
  const slot = $derived(visibleId ? `pi-conversation:${visibleId}` : draftSlot);
  $effect(() => { if (slot && !snapshot.loading && !submitting && slot !== drafts.peekSlot()) { draft = ''; void drafts.openSlot(slot); } });
  $effect(() => { drafts.record(draft); });
  $effect(() => { draft; const element = input; if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 240)}px`; } });
  $effect(() => { if (!titleFocused) titleDraft = snapshot.title; });
  $effect(() => { if (snapshot.initialized && !snapshot.loading && reported !== visibleId) { reported = visibleId; onConversationChange?.(visibleId); } });
  $effect(() => { if (!input || !onSurfaceHandleChange) return; const notify = onSurfaceHandleChange; notify({ focusComposer() { focusComposer(); return true; } }); return () => notify(null); });
  $effect(() => {
    if (menu !== 'writeFolders' || !accessButton || !folderPanel) return;
    folderPanelStyle = hiddenFloatingPanelStyle;
    return positionFloatingPanel(accessButton, folderPanel, style => { folderPanelStyle = style; }, {
      placement: 'top-start', fallbackPlacements: ['top-end', 'bottom-start', 'bottom-end']
    });
  });
  $effect.pre(() => {
    transcript; progress; snapshot.loading; snapshot.editReviews;
    if (!scrollRoot || !scrollController) return;
    const restore = scrollController.preserveRenderPosition();
    void tick().then(restore);
  });
  function trackScroll(root: HTMLElement, options: Parameters<typeof createChatMessageScroll>[1]) {
    const controller = createChatMessageScroll(root, options);
    scrollController = controller;
    return { update: controller.update, destroy() { controller.destroy(); scrollController = undefined; } };
  }
  function focusComposer() { composerDock?.onExpand(); requestAnimationFrame(() => input?.focus({ preventScroll: true })); }
  async function action(work: () => Promise<unknown>) { try { await work(); } catch (error) { binding.report(error); } }
  function openWriteFolders() {
    if (folderSaving) return;
    const authority = snapshot.authority;
    if (!authority || authority.write.grant.duration === 'off') return;
    folderAuthority = { id: authority.authorityId, revision: authority.revision };
    folderDraft = authority.write.grant.scope.folders.join('\n'); folderError = null; menu = 'writeFolders';
  }
  async function saveWriteFolders() {
    const authority = snapshot.authority;
    if (folderSaving) return;
    if (!authority || authority.write.grant.duration === 'off' || folderAuthority?.id !== authority.authorityId || folderAuthority.revision !== authority.revision) {
      folderError = 'Chat access changed. Reopen Allowed write folders before saving.'; return;
    }
    folderSaving = true; folderError = null;
    try {
      await binding.changeWrite(withWriteFolders(authority.write, folderDraft));
      if (snapshot.authority?.authorityId === folderAuthority.id) menu = null;
    } catch (error) {
      folderError = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'Allowed write folders could not be saved. Reopen the controls to check current access.';
    }
    finally { folderSaving = false; }
  }
  async function submit() {
    if (runtimeUnavailable || submitting || !draft.trim()) return;
    sourceNotice = null; ++sourceNavigation;
    const submitted = draft, selection = composerSelection; submitting = true;
    try { const submission = await binding.send(submitted); const admitted = await submission?.status(PI_CONTEXT); if (admitted && String(admitted.conversationId) === visibleId) { if (draft === submitted) draft = ''; if (slot) drafts.promoteSlot(slot, draft); } }
    catch (error) { if (selection === composerSelection && slot) drafts.promoteSlot(slot, draft); binding.report(error); } finally { submitting = false; }
  }
  function onComposerKeydown(event: KeyboardEvent) {
    // Touch Return edits the draft; Safari may report composition through keyCode.
    if (!keyboardShortcutMatchesEvent(event, 'chatSend') || event.isComposing || event.keyCode === 229 || window.matchMedia('(any-pointer: coarse)').matches) return;
    event.preventDefault();
    void submit();
  }
  async function switchConversation(id: string | null) { ++composerSelection; menu = null; await action(() => id ? binding.select(id) : binding.startNew()); }
  async function older() {
    if (!scrollRoot || !scrollController) return;
    const root = scrollRoot, controller = scrollController, id = visibleId, height = root.scrollHeight, top = root.scrollTop;
    controller.pause();
    await action(binding.loadOlder); await tick();
    if (id === visibleId && root.isConnected) controller.restore({ scrollTop: top + root.scrollHeight - height, followingLatest: false });
  }
  function openSource(sourceId: string) {
    sourceNotice = null;
    const request = ++sourceNavigation, authority = snapshot.authority?.authorityId;
    if (!authority || !onOpenSource) { binding.report(new Error('This source is unavailable.')); return; }
    const open = onOpenSource;
    void action(async () => {
      const notice = await open(authority, sourceId);
      if (request === sourceNavigation) sourceNotice = notice || null;
    });
  }
  onMount(() => {
    const updateForeground = () => { foreground = document.visibilityState === 'visible' && document.hasFocus(); };
    updateForeground();
    window.addEventListener('focus', updateForeground); window.addEventListener('blur', updateForeground);
    document.addEventListener('visibilitychange', updateForeground);
    if (autoInitialize) void binding.initialize(conversationId);
    const unregister = registerBackgroundSave(async () => { drafts.record(input?.value ?? draft); await drafts.flush(); });
    return () => { window.removeEventListener('focus', updateForeground); window.removeEventListener('blur', updateForeground); document.removeEventListener('visibilitychange', updateForeground); unregister(); drafts.dispose(); };
  });
</script>
<svelte:window onkeydown={event => { if (event.key === 'Escape') menu = null; }} onpointerdown={event => { if (menu && menu !== 'history' && event.target instanceof Element && !event.target.closest('[data-chat-menu]')) menu = null; }} />
<section class={`chat-panel pane-header-host chat-panel--${variant} relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden`} class:chat-panel--docked={Boolean(composerDock)} aria-label="Thought partner chat" data-testid="pi-chat-panel">
  <PaneHeader titleText={snapshot.title} titlePlaceholder="New chat" right={headerActions} split={headerSplit} workspace={variant === 'pane'} {mobileTitleActive}>
    {#snippet title()}<input class="pane-header-title-input" aria-label="Conversation title" placeholder="New chat" disabled={runtimeUnavailable || !snapshot.conversation} bind:value={titleDraft} onfocus={() => titleFocused = true} onblur={() => { titleFocused = false; void action(() => binding.rename(titleDraft)); }} onkeydown={event => { if (event.key === 'Enter') input?.focus(); }} />{/snippet}
    {#snippet secondaryActions()}{#if showConversationPicker}<button type="button" class="pane-header-action relative" aria-label="Conversations" title={activityDescription($activity.status) ?? 'Conversations'} aria-expanded={menu === 'history'} onclick={() => menu = menu === 'history' ? null : 'history'}><History size={18} /><ChatActivityDot status={$activity.status} /></button>{/if}{/snippet}
  </PaneHeader>
  {#if menu === 'history'}<PiConversationPicker {binding} onSelect={switchConversation} />{/if}
  <div role="log" aria-label="Conversation messages" aria-busy={chatPending} data-pane-content class="min-h-0 flex-1 overflow-y-auto" bind:this={scrollRoot} use:trackScroll={{ conversationId: visibleId, ready: snapshot.initialized && !snapshot.loading, positions }}><div class="chat-content-lane">
    {#if chatPending}
      <div class="chat-loading" role="status" data-testid="pi-chat-loading">
        <span class="sr-only">Loading conversation</span>
        <div class="chat-loading-shapes" aria-hidden="true">
          <div class="chat-loading-prompt"></div>
          <div class="chat-loading-response"><span></span><span></span><span></span></div>
        </div>
      </div>
    {:else if !snapshot.initialized}<p role="status">Chat could not open.</p>
    {:else}
      {#if snapshot.historyNext}<button class="pi-subtle" type="button" onclick={older}>Load earlier messages</button>{/if}
      {#if snapshot.entries.length === 0 && !live.run}<p class="pi-empty">What are you thinking about?</p>{/if}
      {#key visibleId}{#each transcript as item (item.key)}
        {#if item.kind === 'activity'}<PiActivityGroup group={item} generationStatus={item === latestItem ? generationStatus : undefined} />
        {:else}<PiMessage message={item.message} actionMessage={item.actionMessage} streaming={item.streaming} admitted={item.message.role === 'assistant'} onOpenSource={openSource} />{/if}
      {/each}{/key}
      {#each snapshot.editReviews ?? [] as review (review.taskId)}
        <PiEditReview {review} disabled={runtimeUnavailable || snapshot.stopping || snapshot.authority?.retired === true} onDecision={decision => action(() => binding.reviewEdit(review.taskId, decision))} />
      {/each}
      {#if progress && !progressInGroup || live.compactions?.length}<div class="pi-activity" role="status" data-testid="pi-activity">
        {#if progress && !progressInGroup}<p><span class:shimmer={!snapshot.stopping}>{progress}…</span></p>{/if}
        {#each live.compactions ?? [] as compact (compact.taskId)}<p>Compacting conversation{compact.blocking ? ' · response waiting' : ''}{compact.retry ? ' · waiting to retry' : ''}</p>{/each}
      </div>{/if}
      {#if live.compactionFailure}<p class="pi-error" role="status">Conversation compaction could not complete.</p>{/if}
      {#if stopped && !live.run && !(failure?.stopReason === 'aborted' && failure.errorMessage)}<p class="pi-stopped" role="status" data-testid="pi-stopped">Stopped.</p>
      {:else if unanswered && !stopped && !failure && !live.run}<p class="pi-error" role="status">The response could not complete. Start a new attempt.</p>{/if}
      {#if (failure || unanswered) && !live.run}<button type="button" class="pi-subtle" data-testid="pi-new-attempt" disabled={runtimeUnavailable || snapshot.authority?.retired} onclick={() => action(binding.newAttempt)}>New attempt</button>{/if}
    {/if}
  </div></div>
  <div class="chat-panel-bottom shrink-0">
    <PiRuntimeDiagnostics diagnostics={snapshot.diagnostics} conversationId={snapshot.conversation?.id} />
    {#if sourceNotice}<div role="status" class="pi-source-notice" data-testid="pi-source-notice">{sourceNotice}<button type="button" aria-label="Dismiss source notice" onclick={() => { sourceNotice = null; }}><X size={14} /></button></div>{/if}
    {#if snapshot.error}<div role="alert" class="pi-alert">{snapshot.error}<button type="button" aria-label="Dismiss chat error" onclick={binding.clearError}><X size={14} /></button>{#if !snapshot.initialized}<button type="button" onclick={() => binding.initialize(conversationId)}>Open chat again</button>{/if}</div>{/if}
    <div class="chat-composer-slot" class:chat-composer-slot--docked={Boolean(composerDock)} use:mountInSlot={composerDock?.slot} inert={composerDock && !composerDock.expanded}><div class="chat-composer-footer pb-3 pt-2 sm:pb-4"><div class="chat-content-lane"><div class="chat-composer-surface" class:chat-composer-surface--inline={variant === 'inline'}>
      {#key visibleId}<PiQueue {inbox} disabled={runtimeUnavailable} onWithdraw={id => { void action(() => binding.withdraw(id)); }} />{/key}
      <textarea bind:this={input} bind:value={draft} class="chat-composer-input" aria-label="Message" placeholder="What are you thinking about?" rows="1" enterkeyhint="enter" disabled={runtimeUnavailable || !snapshot.initialized || snapshot.loading || snapshot.authority?.retired} onfocus={() => composerDock?.onExpand()} onkeydown={onComposerKeydown}></textarea>
      <div class="chat-composer-toolbar">
        <div class="relative" data-chat-menu>
          <button bind:this={accessButton} type="button" class="chat-composer-chip chat-composer-access" aria-label="Vault access" aria-haspopup="menu" aria-expanded={menu === 'access'} disabled={runtimeUnavailable || !snapshot.initialized || snapshot.authority?.retired} onclick={() => menu = menu === 'access' ? null : 'access'}>
            {#if snapshot.read.mode === 'fullVault'}<ShieldCheck class="h-3.5 w-3.5 shrink-0" />{:else}<ShieldOff class="h-3.5 w-3.5 shrink-0" />{/if}
            <span class="chat-composer-access-label">{snapshot.read.mode === 'fullVault' ? 'Full vault' : snapshot.read.attachedNoteIds.length ? 'Limited vault' : 'No notes'}</span><ChevronDown class="h-3 w-3 shrink-0 opacity-60" />
          </button>
          {#if menu === 'access'}<div class="chat-menu chat-menu--up" role="menu" aria-label="Vault access choices">
            {#each [{ mode: 'fullVault' as const, label: 'Full vault' }, { mode: 'attachedNotesOnly' as const, label: 'No notes' }] as option}
              <button type="button" class="chat-menu-item w-full" role="menuitemradio" aria-checked={snapshot.read.mode === option.mode} onclick={() => { menu = null; void action(() => binding.changeRead({ mode: option.mode, attachedNoteIds: [] })); }}><span class="flex-1">{option.label}</span>{#if snapshot.read.mode === option.mode}<Check size={14} />{/if}</button>
            {/each}
            <div class="px-3 py-2 text-xs text-muted-foreground">Write notes in the vault</div>
            <p class="px-3 pb-2 text-xs text-muted-foreground">Changes include note content, properties and filenames. Always and review settings apply to all chats. Choosing this chat turns off Always.</p>
            {#each [{ duration: 'off' as const, label: 'Editing off' }, { duration: 'temporary' as const, label: 'Allow edits in this chat' }, { duration: 'always' as const, label: 'Always allow edits' }] as option}
              <button type="button" class="chat-menu-item w-full" role="menuitemradio" aria-checked={(snapshot.authority?.write.grant.duration ?? 'off') === option.duration} onclick={() => { menu = null; void action(() => binding.changeWrite({ grant: writeGrantForDuration(snapshot.authority?.write, option.duration, snapshot.conversation?.id ?? 0), reviewBeforeApplying: snapshot.authority?.write.reviewBeforeApplying ?? true })); }}><span class="flex-1">{option.label}</span>{#if (snapshot.authority?.write.grant.duration ?? 'off') === option.duration}<Check size={14} />{/if}</button>
            {/each}
            <button type="button" class="chat-menu-item w-full" role="menuitemcheckbox"
              aria-checked={snapshot.authority && snapshot.authority.write.grant.duration !== 'off' && snapshot.authority.write.grant.operations.includes('create') || false}
              disabled={!snapshot.authority || snapshot.authority.write.grant.duration === 'off'}
              onclick={() => { const write = snapshot.authority?.write; if (write && write.grant.duration !== 'off') { const next = withCreationPermission(write, !write.grant.operations.includes('create')); menu = null; void action(() => binding.changeWrite(next)); } }}>
              <span class="flex-1">Allow creating new notes</span>{#if snapshot.authority && snapshot.authority.write.grant.duration !== 'off' && snapshot.authority.write.grant.operations.includes('create')}<Check size={14} />{/if}
            </button>
            <button type="button" class="chat-menu-item w-full" role="menuitem" disabled={folderSaving || !snapshot.authority || snapshot.authority.write.grant.duration === 'off'} onclick={openWriteFolders}>
              Allowed write folders…
            </button>
            <button type="button" class="chat-menu-item w-full" role="menuitemcheckbox" aria-checked={snapshot.authority?.write.reviewBeforeApplying ?? true} disabled={!snapshot.authority} onclick={() => { const write = snapshot.authority?.write; if (write) { menu = null; void action(() => binding.changeWrite({ ...write, reviewBeforeApplying: !write.reviewBeforeApplying })); } }}><span class="flex-1">Review before applying edits</span>{#if snapshot.authority?.write.reviewBeforeApplying ?? true}<Check size={14} />{/if}</button>
          </div>{/if}
          {#if menu === 'writeFolders'}<div bind:this={folderPanel} use:mountInSlot={document.body} data-chat-menu style={folderPanelStyle} class="chat-menu chat-write-folders p-3" role="dialog" aria-label="Write folder permissions">
            <fieldset disabled={folderSaving || runtimeUnavailable} class="grid gap-3">
              <legend class="sr-only">Write folder permissions</legend>
              <WriteFoldersField bind:value={folderDraft} />
              {#if folderError}<p role="alert" class="text-xs text-destructive">{folderError}</p>{/if}
              <div class="flex justify-end gap-3">
                <button type="button" class="text-xs" onclick={() => menu = 'access'}>Cancel</button>
                <button type="button" class="rounded-lg bg-foreground px-3 py-2 text-xs text-background" onclick={() => void saveWriteFolders()}>{folderSaving ? 'Saving…' : 'Save folders'}</button>
              </div>
            </fieldset>
          </div>{/if}
        </div>
        <div class="chat-composer-primary">
          <PiContextUsage usage={snapshot.contextUsage} message={live.generation?.message} compacting={Boolean(live.compactions?.length)} />
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
  .pi-empty { margin-top: 3rem; text-align: center; color: var(--muted-foreground); }
  .pi-activity { margin-block: 1rem; color: var(--muted-foreground); font-size: .8rem; }
  button:disabled { opacity: .4; }
  .pi-alert, .pi-source-notice { display: flex; gap: .5rem; justify-content: space-between; padding: .5rem 1rem; font-size: .8rem; }
  .pi-alert { color: var(--destructive); }
  .pi-source-notice { color: var(--muted-foreground); }
  .pi-subtle { font-size: .8rem; text-decoration: underline; color: var(--muted-foreground); }
  .pi-stopped { font-size: .8rem; color: var(--muted-foreground); }
  .pi-error { color: var(--destructive); font-size: .8rem; }
</style>

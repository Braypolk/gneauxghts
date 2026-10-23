<script lang="ts">
  import { Columns2, CornerUpLeft, FileText, FolderOpen, History, MessagesSquare, Pin, X, Ellipsis, Tags } from '@lucide/svelte';
  import {
    formatShortcutBinding,
    getEffectiveKeyboardShortcutBinding
  } from '#lib/keyboardShortcuts.svelte.js';
  import { MediaQuery } from 'svelte/reactivity';
  import { DropdownMenu } from 'bits-ui';
  import PaneHeader from '#lib/ui/PaneHeader.svelte';
  import ScrollingNoteTags from './ui/ScrollingNoteTags.svelte';
  import { appSettings } from '#lib/appSettings.svelte.js';
  import PaneCommandPicker from '#lib/features/notepad/PaneCommandPicker.svelte';
  import SplitPaneButton from '#lib/features/notepad/SplitPaneButton.svelte';
  import ChatPanel, { type ComposerDock } from '#lib/features/chat/ChatPanel.svelte';
  import { editor as editorAction } from '#lib/features/notepad/editor/editorAction.js';
  import { editorChromeInset } from '#lib/features/notepad/editor/editorChromeInset.js';
  import { paneRailChrome } from './workspace/paneRailChrome';
  import type { PaneRuntime } from '#lib/features/notepad/pane/paneRuntime.svelte.js';
  import type {
    PaneViewModel,
    PaneWorkspaceActions
  } from '#lib/features/notepad/notepadPane.types.js';
  import type { PaneCommandChoice } from '#lib/features/notepad/paneCommandPicker.js';
  import ExternalConflictResolver from '#lib/features/notepad/ui/ExternalConflictResolver.svelte';
  import {
    getPaneTopActions,
    type SplitPaneTopAction
  } from '#lib/features/notepad/workspace/paneTopActions.js';

  interface Props {
    /** Live editor state and DOM refs; readiness must not be copied into the view model. */
    pane: PaneRuntime;
    viewModel: PaneViewModel;
    actions: PaneWorkspaceActions;
    paneCommandFocusRoot?: HTMLElement | null;
    composerDock?: ComposerDock;
    compact?: boolean;
    collapsed?: boolean;
    mobileTitleActive?: boolean;
    onExpand?: () => void;
  }

  let {
    pane,
    viewModel,
    actions,
    composerDock,
    compact = false,
    collapsed = false,
    mobileTitleActive = true,
    onExpand,
    paneCommandFocusRoot = $bindable<HTMLElement | null>(null)
  }: Props = $props();

  const fullWidth = new MediaQuery('(max-width: 639px)');
  let optionsButton = $state<HTMLButtonElement | null>(null);
  let optionsOpen = $state(false);
  const chatBinding = $derived(viewModel.paneKind === 'chat' ? viewModel.chat.session.binding : null);
  const railStatus = $derived(viewModel.paneKind === 'editor'
    ? viewModel.documentStatus.kind === 'idle' ? '' : viewModel.documentStatus.label
    : $chatBinding?.error || ($chatBinding?.view?.docs['pi.live']?.run ? 'Reply in progress' : ''));
  $effect(() => { if (collapsed) optionsOpen = false; });
  let showEditorLoadingIndicator = $state(false);
  $effect(() => {
    showEditorLoadingIndicator = false;
    if (viewModel.paneKind !== 'editor' || pane.ui.isEditorReady) return;
    // Fast presentations should not flash a loading label. This timer only
    // controls feedback; the editor lifecycle still owns readiness.
    const timer = setTimeout(() => { showEditorLoadingIndicator = true; }, 150);
    return () => clearTimeout(timer);
  });
  let historyRequested = false;
  let titleDraft = $state<string | null>(null);
  let titleDraftDocument = $state<PaneViewModel['titleDocument'] | null>(null);
  const titleDraftBelongsToCurrentDocument = $derived(
    titleDraftDocument === viewModel.titleDocument
  );
  const displayedTitle = $derived(
    titleDraftBelongsToCurrentDocument ? titleDraft ?? viewModel.titleValue : viewModel.titleValue
  );
  const railTitle = $derived(viewModel.paneKind === 'chat'
    ? $chatBinding?.title || 'Thought partner'
    : displayedTitle.trim() || 'Untitled note');
  const splitPaneTopActions = $derived(
    getPaneTopActions(viewModel.paneKind, 'split')
  );
  const pinShortcutLabel = $derived(
    formatShortcutBinding(getEffectiveKeyboardShortcutBinding('togglePinCurrentNote'))
  );
  const historyShortcutLabel = $derived(
    formatShortcutBinding(getEffectiveKeyboardShortcutBinding('showHistory'))
  );

  const splitPaneActionIcons = {
    'open-chat': MessagesSquare,
    'open-previous': CornerUpLeft,
    close: X
  } as const;

  const splitPaneActionLabels = {
    'open-chat': 'Open thought partner',
    'open-previous': 'Open previous location',
    close: 'Close pane'
  } as const;

  function runSplitPaneTopAction(action: SplitPaneTopAction) {
    if (action === 'open-chat') {
      return actions.onOpenPaneChoice('thoughtPartner');
    }
    if (action === 'open-previous') {
      return actions.onOpenPaneChoice('previous');
    }
    if (action === 'close') {
      return actions.onClose(viewModel.paneId);
    }
  }
</script>

{#snippet splitPaneButtons()}
  {#each splitPaneTopActions as action}
    {@const ActionIcon = splitPaneActionIcons[action]}
    {@const label = splitPaneActionLabels[action]}
    {#if fullWidth.current && action === 'close'}
      <span class="compact-pane-divider" aria-hidden="true"></span>
    {/if}
    <button
      type="button"
      class="mobile-touch-target pane-header-action"
      onmousedown={(event) => event.preventDefault()}
      onclick={() => void runSplitPaneTopAction(action)}
      aria-label={label}
      title={label}
    >
      <ActionIcon class="h-4 w-4" />
    </button>
  {/each}
{/snippet}

{#snippet paneButtons()}
  {#if viewModel.showCloseButton}
    {@render splitPaneButtons()}
  {:else}
    <SplitPaneButton paneKind={viewModel.paneKind} onSplit={actions.onSplit} onOpenCurrent={actions.onOpenPaneChoice} />
    {#if fullWidth.current}
      <div class="compact-pane-switch flex items-center gap-1 sm:hidden">
        {#if viewModel.paneKind === 'editor'}
          <button type="button" class="mobile-touch-target pane-header-action" onmousedown={(event) => event.preventDefault()}
            onclick={() => void actions.onOpenPaneChoice('thoughtPartner')} aria-label="Open thought partner" title="Open thought partner">
            <MessagesSquare class="h-4 w-4" />
          </button>
        {/if}
        <button type="button" class="mobile-touch-target pane-header-action" onmousedown={(event) => event.preventDefault()}
          onclick={() => void actions.onOpenPaneChoice('previous')} aria-label="Open previous location" title="Open previous location">
          <CornerUpLeft class="h-4 w-4" />
        </button>
        <span class="compact-pane-divider" aria-hidden="true"></span>
        <button type="button" class="mobile-touch-target pane-header-action" onmousedown={(event) => event.preventDefault()}
          onclick={() => void actions.onSplit()} aria-label="Split pane" title="Open split pane options">
          <Columns2 class="h-4 w-4" />
        </button>
      </div>
    {:else}
      <div class="mobile-pane-switch sm:hidden">
        <button
          type="button"
          class="mobile-touch-target pane-header-action"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => void actions.onOpenPaneChoice(viewModel.paneKind === 'editor' ? 'thoughtPartner' : 'previous')}
          aria-label={viewModel.paneKind === 'editor' ? 'Open thought partner' : 'Open previous location'}
          title={viewModel.paneKind === 'editor' ? 'Open thought partner' : 'Open previous location'}
        >
          {#if viewModel.paneKind === 'editor'}<MessagesSquare class="h-4 w-4" />{:else}<CornerUpLeft class="h-4 w-4" />{/if}
        </button>
      </div>
    {/if}
  {/if}
{/snippet}

<div
  bind:this={pane.refs.paneCard}
  class={viewModel.bodyClass}
  role="group"
  aria-label={viewModel.ariaLabel}
  data-testid="workspace-pane"
  data-pane-id={viewModel.paneId}
  data-pane-kind={viewModel.paneKind}
  data-pane-collapsed={collapsed || undefined}
  data-pane-compact={compact || undefined}
  onpointerdown={() => { if (!collapsed) actions.onActivate(viewModel.paneId); }}
  onfocusin={() => { if (!collapsed) actions.onActivate(viewModel.paneId); }}
>
  {#if compact}
    <button type="button" class="pane-rail-surface" class:pane-rail={collapsed} onclick={onExpand}
      disabled={!collapsed} aria-hidden={!collapsed || undefined} tabindex={collapsed ? 0 : -1}
      aria-label={`Expand ${railTitle}${railStatus ? `. ${railStatus}` : ''}`}
      aria-expanded="false" aria-controls={`pane-frame-${viewModel.paneId}`}
      title={`${railTitle}${railStatus ? ` — ${railStatus}` : ''}`}>
      <span class="pane-rail-label">
        {#if railStatus}<span class="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>{/if}
        <span class="pane-rail-icon" aria-hidden="true">
          {#if viewModel.paneKind === 'editor'}<FileText class="h-4 w-4" />{:else}<MessagesSquare class="h-4 w-4" />{/if}
        </span>
        <span class="pane-rail-title">{railTitle}</span>
      </span>
    </button>
  {/if}
  {#if viewModel.showActiveBorder && !compact}
    <div data-pane-border={viewModel.paneId} class="pointer-events-none absolute inset-0 z-20 hidden rounded-t-4xl shadow-[inset_0_0_0_2px_var(--border)] sm:block"></div>
  {/if}
  <div class="pane-viewport relative flex min-h-0 min-w-0 flex-1">
    <div class={viewModel.frameClass} use:paneRailChrome={viewModel.paneKind} data-pane-frame id={`pane-frame-${viewModel.paneId}`} inert={collapsed} aria-hidden={collapsed ? 'true' : undefined}>
      {#if viewModel.paneKind === 'editor'}
        <div class="notepad-editor-top-overlay pane-header-host absolute inset-x-0 top-0 z-20">
          <PaneHeader
            titleText={displayedTitle}
            titlePlaceholder={viewModel.titlePlaceholder}
            titleMeasureTestId="note-title-measure"
            bind:titleShell={pane.refs.titleShell}
            workspace
            {mobileTitleActive}
            split={viewModel.showCloseButton}
            right={paneButtons}
          >
            {#snippet secondaryActions()}
              <DropdownMenu.Root bind:open={optionsOpen} onOpenChange={(open) => { if (open) actions.onNoteOptionsOpen(); }}>
                <DropdownMenu.Trigger bind:ref={optionsButton} class="mobile-touch-target pane-header-action" aria-label="Note options" title="Note options">
                  <Ellipsis class="h-4 w-4" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content onCloseAutoFocus={(event) => {
                    if (historyRequested) {
                      event.preventDefault();
                      historyRequested = false;
                      optionsButton?.focus();
                      void actions.onOpenHistory(viewModel.paneId);
                    }
                  }} align="start" sideOffset={6} class="z-50 min-w-48 rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-lg outline-none">
                    <DropdownMenu.Item aria-label="Open note history" disabled={!viewModel.canPin} class="flex cursor-default items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40" onSelect={() => { historyRequested = true; }}>
                      <History class="h-4 w-4" /> Note history <span class="ml-auto pl-3 text-xs text-muted-foreground">{historyShortcutLabel}</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item aria-label="Open file location" disabled={!viewModel.canOpenFileLocation} class="flex cursor-default items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40" onSelect={() => { void actions.onOpenFileLocation(viewModel.paneId); }}>
                      <FolderOpen class="h-4 w-4" /> Open file location
                    </DropdownMenu.Item>
                    <DropdownMenu.Item class="flex cursor-default items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-accent" onSelect={() => { appSettings.setTagsVisible(!appSettings.tagsVisible); }}>
                      <Tags class="h-4 w-4" /> {appSettings.tagsVisible ? 'Hide tags' : 'Show tags'}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            {/snippet}
            {#snippet primaryActions()}
              <button
                type="button"
                disabled={!viewModel.canPin}
                class={`mobile-touch-target pane-header-pin absolute top-1/2 right-[calc(100%+0.25rem)] inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground ${viewModel.isPinned ? 'text-accent-foreground' : ''}`}
                aria-label={viewModel.isPinned ? 'Unpin note' : 'Pin note'}
                aria-pressed={viewModel.isPinned}
                title={`${viewModel.isPinned ? 'Unpin note' : 'Pin note'} (${pinShortcutLabel})`}
                onmousedown={(event) => event.preventDefault()}
                onclick={() => void actions.onTogglePin(viewModel.paneId)}
              >
                <Pin
                  class={`h-4 w-4 transition-[rotate,fill] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none ${viewModel.isPinned ? '-rotate-45' : 'rotate-0'}`}
                  fill={viewModel.isPinned ? 'currentColor' : 'none'}
                />
              </button>
            {/snippet}
            {#snippet title()}
              <input
                bind:this={pane.refs.titleInput}
                type="text"
                size="1"
                data-testid="note-title"
                class={viewModel.titleClass}
                placeholder={viewModel.titlePlaceholder}
                value={displayedTitle}
                readonly={viewModel.titleReadonly}
                onfocus={() => {
                  titleDraft = viewModel.titleValue;
                  titleDraftDocument = viewModel.titleDocument;
                  actions.onTitleFocus(viewModel.paneId);
                }}
                oninput={(event) => {
                  titleDraft = (event.currentTarget as HTMLInputElement).value;
                  titleDraftDocument = viewModel.titleDocument;
                  actions.onTitleInput(viewModel.paneId);
                }}
                onblur={() => {
                  const shouldCommit = titleDraftDocument === viewModel.titleDocument;
                  const rawTitle = titleDraft ?? viewModel.titleValue;
                  titleDraft = null;
                  if (shouldCommit) {
                    actions.onTitleBlur(viewModel.paneId, rawTitle);
                  }
                }}
                onkeydown={(event) => actions.onTitleKeydown(viewModel.paneId, event)}
              />
            {/snippet}
          </PaneHeader>
        </div>
      {/if}

      {#if viewModel.paneKind === 'editor'}
        <div class="flex h-full min-w-0 flex-1 min-h-0 flex-col">

          <div
            bind:this={pane.refs.editorShell}
            use:editorChromeInset
            class={`notepad-editor-shell relative h-full min-h-0 min-w-0 flex-1 overflow-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] ${
              viewModel.isSlashMenuOpen ? 'overscroll-none touch-none' : ''
            } ${
              viewModel.isPaneCommandOpen
                ? '[--editor-scroll-past-end:0px]'
                : ''
            }`}
          >
            <ExternalConflictResolver
              status={viewModel.documentStatus}
              onKeepMyEdits={() => actions.onKeepMyEdits(viewModel.paneId)}
              onLoadDiskVersion={() => actions.onLoadDiskVersion(viewModel.paneId)}
              onCopyMyEdits={() => actions.onCopyMyEdits(viewModel.paneId)}
            />
            {#if !pane.ui.isEditorReady && showEditorLoadingIndicator}
              <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
                  Loading editor
                </span>
              </div>
            {/if}

            <div
              bind:this={pane.refs.editorRoot}
              data-testid="note-editor"
              aria-busy={!pane.ui.isEditorReady}
              class:editor-loading={!pane.ui.isEditorReady}
              data-pane-content
              class="relative h-full min-h-full w-full min-w-0 max-w-full overflow-x-clip"
              use:editorAction={viewModel.editorLifecycle}
            ></div>

            {#if appSettings.tagsVisible && pane.ui.isEditorReady}
              {#key viewModel.titleDocument.handle}
                {@const tagDocument = viewModel.titleDocument}
                <ScrollingNoteTags view={pane.controller?.view} tags={tagDocument.working.tags ?? []} error={tagDocument.working.tagsError} disabled={viewModel.titleReadonly} onChange={(tags) => actions.onUpdateTags(viewModel.paneId, tagDocument.handle, tags)} onDone={() => pane.controller?.view.focus()} />
              {/key}
            {/if}

            {#if viewModel.isPaneCommandOpen}
              <div class="pointer-events-none absolute inset-0 z-20">
                <div class="pane-command-scroll pointer-events-auto absolute top-[calc(var(--editor-top-padding)+5.25rem)] bottom-(--command-bar-clearance) overflow-y-auto overscroll-contain left-1/2 box-border w-[min(calc(100%-2rem),var(--content-readable-width))] max-w-md -translate-x-1/2 cursor-default">
                  <div class="w-full flex items-center pb-6 gap-3">
                    <div class="flex-1 h-[1px] rounded-full bg-border/70"></div>
                    <span class="text-base md:text-lg text-muted-foreground/80 select-none">or</span>
                    <div class="flex-1 h-[1px] rounded-full bg-border/70"></div>
                  </div>

                  <PaneCommandPicker
                    bind:focusRoot={paneCommandFocusRoot}
                    highlightedIndex={viewModel.paneCommandHighlightedIndex}
                    mode={viewModel.paneCommandMode}
                    presentation="embedded"
                    currentNoteLabel={viewModel.paneCommandCurrentNoteLabel}
                    previousNoteLabel={viewModel.paneCommandPreviousNoteLabel}
                    previousNoteShortcutLabel={viewModel.paneCommandPreviousNoteShortcutLabel}
                    onHighlightChange={actions.onPaneCommandHighlightChange}
                    onChoose={(choice: PaneCommandChoice) => void actions.onPaneCommandChoose(viewModel.paneId, choice)}
                  />
                </div>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="chat-pane-shell flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">
          <ChatPanel
            binding={viewModel.chat.session.binding}
            conversationId={viewModel.chat.session.conversationId}
            draftSlot={viewModel.chat.session.draftSlot}
            variant="pane"
            {composerDock}
            headerActions={paneButtons}
            headerSplit={viewModel.showCloseButton}
            {mobileTitleActive}
            onConversationChange={viewModel.chat.session.onConversationChange}
            onOpenSource={viewModel.chat.context.onOpenSource}
            onSurfaceHandleChange={viewModel.chat.session.onSurfaceHandleChange}
          />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .compact-pane-divider { width: 1px; height: 1.5rem; margin-inline: 0.25rem; background: var(--border); }
  /* Keep layout measurable while parsing and scroll restoration finish. */
  .editor-loading {
    visibility: hidden;
    pointer-events: none;
  }

  .notepad-pane {
    flex: 1 1 0;
    min-width: 0;
    opacity: 1;
  }

  .notepad-pane--collapsing {
    flex-grow: 0;
    flex-basis: 0;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .notepad-pane[data-pane-collapsed] {
    flex: 0 0 var(--pane-rail-width);
  }

  .notepad-pane[data-pane-compact] {
    /* The rail travels across its neighbor; only the retained content clips. */
    z-index: auto;
  }

  .notepad-pane[data-pane-compact].notepad-pane--collapsing {
    flex: 0 0 0;
    opacity: 1;
    overflow: visible;
  }

  .notepad-pane[data-pane-compact].notepad-pane--collapsing:first-child > .pane-rail-surface {
    left: calc(0px - var(--pane-rail-width));
  }

  .notepad-pane[data-pane-compact] > .pane-viewport {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 0;
    overflow: clip;
    --pane-clip-inset: 0px;
    width: calc(100% - var(--pane-clip-inset));
  }

  /* Anchor the clip and frame to the same outer edge. Width clamps at zero
     without moving that edge when a departing pane is narrower than its rail.
     Overflow clipping preserves header backdrop sampling. */
  .notepad-pane[data-pane-compact]:last-child > .pane-viewport {
    inset: 0 0 0 auto;
  }
  .notepad-pane[data-pane-compact][data-pane-collapsed] > .pane-viewport {
    --pane-clip-inset: var(--pane-rail-width);
  }

  .notepad-pane[data-pane-compact] > .pane-viewport > [data-pane-frame] {
    /* Retain the expanded wrapping/scroll geometry in the mounted neighbor. */
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--compact-pane-content-width);
  }

  .notepad-pane[data-pane-compact]:last-child > .pane-viewport > [data-pane-frame] {
    /* The right edge stays fixed as flex widths exchange. Reveal stationary
       content through the pane's clip instead of carrying it with the divider. */
    inset: 0 0 0 auto;
  }

  .notepad-pane[data-pane-collapsed] > .pane-viewport > [data-pane-frame] {
    /* Opacity preserves measured editor geometry; inert handles interaction
       without inherited visibility or pointer styles in the retained tree. */
    opacity: 0;
  }

  :global([data-pane-motion]) .notepad-pane[data-pane-compact] > .pane-viewport > [data-pane-frame] {
    /* Avoid even a constant opacity animation on a backdrop-filter ancestor. */
    opacity: 1;
  }

  .pane-rail-surface {
    position: absolute;
    /* Retained frames have their own positioned stacking context. */
    z-index: 1;
    inset: 0;
    width: var(--pane-rail-width);
    top: var(--pane-rail-header-clearance, var(--editor-overlay-inset));
    bottom: var(--command-bar-clearance);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem 0.5rem;
    opacity: 0;
    color: var(--muted-foreground);
    touch-action: manipulation;
  }
  .pane-rail-surface::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: color-mix(in oklab, var(--muted) 60%, var(--card));
    mask-image: linear-gradient(to bottom, transparent, black 3rem, black calc(100% - 3rem), transparent);
  }
  .pane-rail { opacity: 1; }
  .pane-rail:hover { color: var(--accent-foreground); }
  .pane-rail:hover::before { background: var(--accent); }
  .pane-rail:focus-visible { outline: 2px solid var(--ring); outline-offset: -3px; }
  .pane-rail-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 0;
    max-height: 100%;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }
  .pane-rail-icon { flex-shrink: 0; transform: rotate(90deg); }
  .pane-rail-title {
    min-height: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  :global([data-pane-motion]) .notepad-pane:not([data-pane-compact]) {
    /* Focus in the fixed-width content must not horizontally scroll the pane
       (and its border) while the outer shell is still opening. */
    overflow: clip;
  }

  /*
   * The editor's vertical padding is composed here rather than on
   * `.notepad-shell` because both inputs are overridden on this element: the
   * measured overlay inset by `editorChromeInset`, and the scroll slack by the
   * pane command picker. A custom property substitutes its own `var()`
   * references where it is declared, so the composition has to sit alongside
   * the overrides to see them.
   */
  .notepad-editor-shell {
    --editor-top-padding: calc(
      var(--editor-overlay-inset) + var(--editor-top-breathing-room)
    );
    --editor-bottom-padding: calc(
      var(--editor-chrome-clearance) + var(--editor-scroll-past-end)
    );
  }


  /* Short landscape windows use the same compact workspace controls. */
  @media (max-height: 559px) and (min-width: 640px) {
    .mobile-pane-switch { display: inline-flex !important; }
    :global(.split-pane-control) { display: none !important; }
  }
</style>

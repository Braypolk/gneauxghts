<script lang="ts">
  import { CornerUpLeft, FolderOpen, History, MessagesSquare, Pin, X, Ellipsis, Tags } from '@lucide/svelte';
  import {
    formatShortcutBinding,
    getEffectiveKeyboardShortcutBinding
  } from '$lib/keyboardShortcuts.svelte';
  import { DropdownMenu } from 'bits-ui';
  import PaneHeader from '$lib/ui/PaneHeader.svelte';
  import ScrollingNoteTags from './ui/ScrollingNoteTags.svelte';
  import { appSettings } from '$lib/appSettings.svelte';
  import PaneCommandPicker from '$lib/features/notepad/PaneCommandPicker.svelte';
  import SplitPaneButton from '$lib/features/notepad/SplitPaneButton.svelte';
  import ChatPanel, { type ComposerDock } from '$lib/features/chat/ChatPanel.svelte';
  import { editor as editorAction } from '$lib/features/notepad/editor/editorAction';
  import { editorChromeInset } from '$lib/features/notepad/editor/editorChromeInset';
  import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
  import type {
    PaneViewModel,
    PaneWorkspaceActions
  } from '$lib/features/notepad/notepadPane.types';
  import type { PaneCommandChoice } from '$lib/features/notepad/paneCommandPicker';
  import ExternalConflictResolver from '$lib/features/notepad/ui/ExternalConflictResolver.svelte';
  import {
    getPaneTopActions,
    type SplitPaneTopAction
  } from '$lib/features/notepad/workspace/paneTopActions';

  interface Props {
    /** Live editor state and DOM refs; readiness must not be copied into the view model. */
    pane: PaneRuntime;
    viewModel: PaneViewModel;
    actions: PaneWorkspaceActions;
    paneCommandFocusRoot?: HTMLElement | null;
    composerDock?: ComposerDock;
  }

  let {
    pane,
    viewModel,
    actions,
    composerDock,
    paneCommandFocusRoot = $bindable<HTMLElement | null>(null)
  }: Props = $props();

  let optionsButton = $state<HTMLButtonElement | null>(null);
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
    <button
      type="button"
      class="mobile-touch-target pane-header-action"
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
{/snippet}

<div
  bind:this={pane.refs.paneCard}
  class={viewModel.bodyClass}
  role="group"
  aria-label={viewModel.ariaLabel}
  data-testid="workspace-pane"
  data-pane-id={viewModel.paneId}
  data-pane-kind={viewModel.paneKind}
  onpointerdown={() => actions.onActivate(viewModel.paneId)}
  onfocusin={() => actions.onActivate(viewModel.paneId)}
>
  {#if viewModel.showActiveBorder}
    <div data-pane-border={viewModel.paneId} class="pointer-events-none absolute inset-0 z-20 hidden rounded-t-4xl shadow-[inset_0_0_0_2px_var(--border)] sm:block"></div>
  {/if}
  <div class={viewModel.frameClass} data-pane-frame>
    {#if viewModel.paneKind === 'editor'}
      <div class="notepad-editor-top-overlay pane-header-host absolute inset-x-0 top-0 z-20">
        <PaneHeader
          titleText={displayedTitle}
          titlePlaceholder={viewModel.titlePlaceholder}
          titleMeasureTestId="note-title-measure"
          bind:titleShell={pane.refs.titleShell}
          workspace
          split={viewModel.showCloseButton}
          right={paneButtons}
        >
          {#snippet left()}
            <DropdownMenu.Root onOpenChange={(open) => { if (open) actions.onNoteOptionsOpen(); }}>
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
          {#snippet titleLeading()}
            <button
              type="button"
              disabled={!viewModel.canPin}
              class={`mobile-touch-target absolute top-1/2 right-[calc(100%+0.25rem)] inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground ${viewModel.isPinned ? 'text-accent-foreground' : ''}`}
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
        <ExternalConflictResolver
          status={viewModel.documentStatus}
          onKeepMyEdits={() => actions.onKeepMyEdits(viewModel.paneId)}
          onLoadDiskVersion={() => actions.onLoadDiskVersion(viewModel.paneId)}
          onCopyMyEdits={() => actions.onCopyMyEdits(viewModel.paneId)}
        />
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
              <div class="pointer-events-auto absolute top-[calc(var(--editor-top-padding)+5.25rem)] left-1/2 box-border w-[min(calc(100%-2rem),var(--content-readable-width))] max-w-md -translate-x-1/2 cursor-default">
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
        {#if viewModel.chat.session.controller}
          <ChatPanel
            controller={viewModel.chat.session.controller}
            conversationId={viewModel.chat.session.conversationId}
            draftSlot={viewModel.chat.session.draftSlot}
            contextNote={viewModel.chat.context.note}
            getActiveNoteSnapshot={viewModel.chat.context.getActiveNoteSnapshot}
            targetAnchor={viewModel.chat.session.targetAnchor}
            variant="pane"
            {composerDock}
            headerActions={paneButtons}
            headerSplit={viewModel.showCloseButton}
            selectionActions={viewModel.chat.context.selectionActions}
            onConversationChange={viewModel.chat.session.onConversationChange}
            onOpenCitation={viewModel.chat.context.onOpenCitation}
            onOpenWikilink={viewModel.chat.context.onOpenWikilink}
            onSurfaceHandleChange={viewModel.chat.session.onSurfaceHandleChange}
            proposalSnapshot={viewModel.chat.proposalReview.snapshot}
            onProposalKeepAll={viewModel.chat.proposalReview.onKeepAll}
            onProposalUndoAll={viewModel.chat.proposalReview.onUndoAll}
            onProposalReview={viewModel.chat.proposalReview.onReview}
            onProposalRetry={viewModel.chat.proposalReview.onRetry}
            onProposalCopyCurrent={viewModel.chat.proposalReview.onCopyCurrent}
            onProposalReloadDisk={viewModel.chat.proposalReview.onReloadDisk}
            onReviewAgentProposal={viewModel.chat.proposalReview.onReviewAgentProposal}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
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

  :global([data-pane-motion]) .notepad-pane {
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

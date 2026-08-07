<script lang="ts">
  import { CornerUpLeft, MessagesSquare, X } from '@lucide/svelte';
  import PaneCommandPicker from '$lib/features/notepad/PaneCommandPicker.svelte';
  import SplitPaneButton from '$lib/features/notepad/SplitPaneButton.svelte';
  import ChatPanel from '$lib/features/chat/ChatPanel.svelte';
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
    pane: PaneRuntime;
    viewModel: PaneViewModel;
    actions: PaneWorkspaceActions;
    paneCommandFocusRoot?: HTMLElement | null;
  }

  let {
    pane,
    viewModel,
    actions,
    paneCommandFocusRoot = $bindable<HTMLElement | null>(null)
  }: Props = $props();

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
      class="mobile-touch-target mobile-pane-top-action inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80"
      onclick={() => void runSplitPaneTopAction(action)}
      aria-label={label}
      title={label}
    >
      <ActionIcon class="h-4 w-4" />
    </button>
  {/each}
{/snippet}

<div
  bind:this={pane.refs.paneCard}
  class={viewModel.bodyClass}
  role="group"
  aria-label={viewModel.ariaLabel}
  onpointerdown={() => actions.onActivate(viewModel.paneId)}
  onfocusin={() => actions.onActivate(viewModel.paneId)}
>
  <div class={viewModel.frameClass}>
    {#if viewModel.paneKind === 'editor'}
      <div class="notepad-editor-top-overlay absolute inset-x-0 top-0 z-20">
        <div class="pointer-events-none absolute inset-0 bg-card/58 backdrop-blur-sm" style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%);"></div>
        <div class="notepad-editor-top-row relative z-10 flex items-center justify-between gap-2 px-3 pt-3 pb-2 sm:gap-3 sm:px-4 sm:pt-4 sm:pb-3">
          <div class="h-10 w-10 shrink-0 sm:h-9 sm:w-9" aria-hidden="true"></div>
          <div class="notepad-editor-title-wrap pointer-events-none absolute inset-x-14 top-3 flex justify-center sm:inset-x-16 sm:top-4">
            <div bind:this={pane.refs.titleShell} class="pointer-events-auto w-full max-w-[24rem] min-w-0">
              <input
                bind:this={pane.refs.titleInput}
                type="text"
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
            </div>
          </div>
          {#if viewModel.showCloseButton}
            <div class="flex items-center gap-2">
              {@render splitPaneButtons()}
            </div>
          {:else}
            <SplitPaneButton paneKind="editor" onSplit={actions.onSplit} onOpenCurrent={actions.onOpenPaneChoice} />
            <button
              type="button"
              class="mobile-touch-target mobile-pane-top-action mobile-thought-partner-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 sm:hidden"
              onclick={() => void actions.onOpenPaneChoice('thoughtPartner')}
              aria-label="Open thought partner"
              title="Open thought partner"
            >
              <MessagesSquare class="h-[1.1rem] w-[1.1rem]" />
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="notepad-chat-top-actions absolute right-4 top-3 z-30 flex items-center gap-2 sm:top-4">
        {#if viewModel.showCloseButton}
          {@render splitPaneButtons()}
        {:else}
          <div class="chat-pane-split-slot relative hidden h-9 shrink-0 sm:block">
            <SplitPaneButton
              paneKind="chat"
              onSplit={actions.onSplit}
              onOpenCurrent={actions.onOpenPaneChoice}
            />
          </div>
          <div class="sm:hidden">
            <button
              type="button"
              class="mobile-touch-target mobile-pane-top-action inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80"
              onclick={() => void actions.onOpenPaneChoice('previous')}
              aria-label="Open previous location"
              title="Open previous location"
            >
              <CornerUpLeft class="h-4 w-4" />
            </button>
          </div>
        {/if}
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
          {#if !viewModel.isEditorReady}
            <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
                Loading editor
              </span>
            </div>
          {/if}

          <div
            bind:this={pane.refs.editorRoot}
            class="relative h-full min-h-full w-full min-w-0 max-w-full overflow-x-clip"
            use:editorAction={viewModel.editorLifecycle}
          ></div>

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
      <div class="chat-pane-shell flex min-h-0 flex-1 pb-(--command-bar-clearance)">
        {#if viewModel.chat.session.controller}
          <ChatPanel
            controller={viewModel.chat.session.controller}
            conversationId={viewModel.chat.session.conversationId}
            draftSlot={viewModel.chat.session.draftSlot}
            contextNote={viewModel.chat.context.note}
            getActiveNoteSnapshot={viewModel.chat.context.getActiveNoteSnapshot}
            targetAnchor={viewModel.chat.session.targetAnchor}
            variant="pane"
            selectionActions={viewModel.chat.context.selectionActions}
            onConversationChange={viewModel.chat.session.onConversationChange}
            onOpenCitation={viewModel.chat.context.onOpenCitation}
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

  /* SplitPaneButton fans its quick actions left from a w-9 anchor. */
  .chat-pane-split-slot {
    width: 11.75rem;
  }

  .chat-pane-split-slot :global(.split-pane-control) {
    position: absolute;
    top: 0;
    right: 0;
  }

  @media (max-width: 639px) {
    .notepad-editor-title-wrap {
      right: 7rem;
      left: 10rem;
    }

    .mobile-pane-top-action {
      margin-right: 4.25rem;
    }

    .notepad-chat-top-actions {
      right: 5rem;
    }

    .notepad-chat-top-actions .mobile-pane-top-action {
      margin-right: 0;
    }
  }

  /* Landscape phones can satisfy width-based desktop breakpoints while still
     having very little vertical room. Keep their pane chrome mobile-sized. */
  @media (max-height: 559px) and (min-width: 640px) {
    .notepad-editor-top-row {
      gap: 0.5rem;
      padding: 0.75rem 0.75rem 0.5rem;
    }

    .notepad-editor-title-wrap {
      top: 0.75rem;
      right: 3.5rem;
      left: 3.5rem;
    }

    .mobile-thought-partner-button {
      display: inline-flex !important;
    }

    .chat-pane-split-slot,
    :global(.split-pane-control) {
      display: none !important;
    }
  }
</style>

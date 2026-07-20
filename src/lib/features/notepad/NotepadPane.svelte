<script lang="ts">
  import { FileText, MessagesSquare, X } from '@lucide/svelte';
  import PaneCommandPicker from '$lib/features/notepad/PaneCommandPicker.svelte';
  import SplitPaneButton from '$lib/features/notepad/SplitPaneButton.svelte';
  import ChatPanel from '$lib/features/chat/ChatPanel.svelte';
  import { editor as editorAction } from '$lib/features/notepad/editor/editorAction';
  import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
  import type {
    PaneViewModel,
    PaneWorkspaceActions
  } from '$lib/features/notepad/notepadPane.types';
  import type { PaneCommandChoice } from '$lib/features/notepad/paneCommandPicker';

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
  const displayedTitle = $derived(titleDraft ?? viewModel.titleValue);
</script>

{#snippet closePaneButton()}
  <button
    type="button"
    class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    onclick={() => void actions.onClose(viewModel.paneId)}
    aria-label="Close this pane"
    title="Close pane"
  >
    <X class="h-4 w-4" />
  </button>
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
                  actions.onTitleFocus(viewModel.paneId);
                }}
                oninput={(event) => {
                  titleDraft = (event.currentTarget as HTMLInputElement).value;
                  actions.onTitleInput(viewModel.paneId);
                }}
                onblur={() => {
                  const rawTitle = titleDraft ?? viewModel.titleValue;
                  titleDraft = null;
                  actions.onTitleBlur(viewModel.paneId, rawTitle);
                }}
                onkeydown={(event) => actions.onTitleKeydown(viewModel.paneId, event)}
              />
            </div>
          </div>
          {#if viewModel.showCloseButton}
            {@render closePaneButton()}
          {:else}
            <SplitPaneButton onSplit={actions.onSplit} onOpenCurrent={actions.onOpenPaneChoice} />
            <button
              type="button"
              class="mobile-thought-partner-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 sm:hidden"
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
      <div class="absolute right-4 top-4 z-30 flex items-center gap-2">
        <button
          type="button"
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onclick={() => void actions.onSwitchToEditor(viewModel.paneId)}
          aria-label="Back to note"
          title="Back to note"
        >
          <FileText class="h-4 w-4" />
        </button>
        {#if viewModel.showCloseButton}
          {@render closePaneButton()}
        {:else}
          <!-- Reserve horizontal room for SplitPaneButton's leftward fan so it never covers Back. -->
          <div class="chat-pane-split-slot relative hidden h-9 shrink-0 sm:block">
            <SplitPaneButton onSplit={actions.onSplit} onOpenCurrent={actions.onOpenPaneChoice} />
          </div>
          <div class="h-9 w-9 shrink-0 sm:hidden" aria-hidden="true"></div>
        {/if}
      </div>
    {/if}

    {#if viewModel.paneKind === 'editor'}
      <div class="flex h-full min-w-0 flex-1 min-h-0 flex-col">
        <div
          bind:this={pane.refs.editorShell}
          class={`notepad-editor-shell relative h-full min-h-0 min-w-0 flex-1 overflow-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] ${
            viewModel.isSlashMenuOpen ? 'overscroll-none touch-none' : ''
          } ${
            viewModel.isPaneCommandOpen
              ? '[--editor-bottom-padding:calc(7rem+env(safe-area-inset-bottom,0px)+var(--keyboard-inset-height,0px))]'
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
              <div class="pointer-events-auto absolute top-[calc(var(--editor-top-padding)+5.25rem)] left-1/2 box-border w-[min(calc(100%-2rem),var(--editor-readable-width))] max-w-md -translate-x-1/2 cursor-default">
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
      <div class="chat-pane-shell flex min-h-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:pb-24">
        {#if viewModel.chatController}
          <ChatPanel
            controller={viewModel.chatController}
            conversationId={viewModel.chatConversationId}
            draftSeed={viewModel.chatDraftSeed}
            contextNote={viewModel.chatContextNote}
            targetAnchor={viewModel.chatTargetAnchor}
            variant="pane"
            selectionActions={viewModel.chatSelectionActions}
            onConversationChange={viewModel.onChatConversationChange}
            onOpenCitation={viewModel.onOpenCitation}
            proposalSnapshot={viewModel.proposalSnapshot}
            proposalPendingCount={viewModel.proposalPendingCount}
            onProposalOpenChange={viewModel.onProposalOpenChange}
            onProposalKeep={viewModel.onProposalKeep}
            onProposalUndo={viewModel.onProposalUndo}
            onProposalKeepAll={viewModel.onProposalKeepAll}
            onProposalUndoAll={viewModel.onProposalUndoAll}
            onProposalReview={viewModel.onProposalReview}
            onProposalRetry={viewModel.onProposalRetry}
            onProposalCopyCurrent={viewModel.onProposalCopyCurrent}
            onProposalReloadDisk={viewModel.onProposalReloadDisk}
            onProposalLoadFixture={viewModel.onProposalLoadFixture}
          />
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /*
    SplitPaneButton fans options left from a w-9 anchor (::before uses -9.5rem).
    Keep that fan inside this slot so Back to note stays clickable to the left.
  */
  .chat-pane-split-slot {
    width: 11.75rem;
  }

  .chat-pane-split-slot :global(.split-pane-control) {
    position: absolute;
    top: 0;
    right: 0;
  }

  /* Landscape phones can satisfy width-based desktop breakpoints while still
     having very little vertical room. Keep their pane chrome mobile-sized. */
  @media (max-height: 559px) {
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

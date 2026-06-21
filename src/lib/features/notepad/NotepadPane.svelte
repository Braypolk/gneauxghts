<script lang="ts">
  import { Columns2, Inbox, X } from '@lucide/svelte';
  import SplitPaneContentPicker from '$lib/features/notepad/SplitPaneContentPicker.svelte';
  import { editor as editorAction } from '$lib/features/notepad/editor/editorAction';
  import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
  import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
  import type { SplitChoice } from '$lib/features/notepad/splitPanePicker';
  import type { PendingProposalNotice, ReviewOverlayModel } from '$lib/features/proposals/session';
  import MarkdownDiffView from '$lib/features/proposals/diff/MarkdownDiffView.svelte';

  type PaneKind = 'editor' | 'chat';

  /**
 * View model describing everything NotepadPane.svelte needs to render.
 * Derived from the pane runtime + workspace-level chrome state.
 */
export interface PaneViewModel {
  paneId: NotepadPaneId;
  paneKind: PaneKind;
  ariaLabel: string;
  bodyClass: string;
  frameClass: string;
  isEditorReady: boolean;
  isSlashMenuOpen: boolean;
  isSplitPickerOpen: boolean;
  showCloseButton: boolean;
  titleClass: string;
  titlePlaceholder: string;
  titleValue: string;
  titleReadonly: boolean;
  chatDescription: string;
  splitPickerHighlightedIndex: number;
  splitPickerCurrentNoteLabel: string;
  splitPickerPreviousNoteLabel: string | null;
  /**
   * Read-only indicator shown when the open note has a pending AI proposal
   * awaiting review in the inbox. `null` when nothing is pending. The editor
   * does not review proposals inline — this only points the user to the inbox.
   */
  pendingProposalNotice: PendingProposalNotice | null;
  /**
   * Read-only review model for the open note's pending `updateNote` proposal,
   * used to render the in-editor review overlay (same current→proposed diff as
   * the inbox). `null` when no pending update touches this note. The overlay is
   * strictly read-only: accept/reject decisions are routed back to the inbox.
   */
  reviewOverlay: ReviewOverlayModel | null;
  /**
   * Editor lifecycle hooks for the use:editor action wired on the editor
   * root. When shouldMount is true, the action invokes mount() once the
   * root node is in the DOM; when shouldMount drops to false, it calls
   * destroy(). The action also calls destroy() if the host node is
   * unmounted while the editor is still mounted.
   */
  editorLifecycle: {
    shouldMount: boolean;
    mount: (node: HTMLDivElement) => Promise<void> | void;
    destroy: () => Promise<void> | void;
  };
}

/**
 * Small workspace action surface the pane can call into.
 */
export interface PaneWorkspaceActions {
  onActivate: (paneId: NotepadPaneId) => void;
  onClose: (paneId: NotepadPaneId) => void | Promise<void>;
  onSplit: () => void | Promise<void>;
  onTitleInput: (paneId: NotepadPaneId, event: Event) => void;
  onTitleBlur: () => void;
  onTitleKeydown: (event: KeyboardEvent) => void;
  onSplitHighlightChange: (index: number) => void;
  onSplitChoose: (paneId: NotepadPaneId, choice: SplitChoice) => void | Promise<void>;
  onOpenInbox: () => void | Promise<void>;
}

interface Props {
  pane: PaneRuntime;
  viewModel: PaneViewModel;
  actions: PaneWorkspaceActions;
  splitPickerFocusRoot?: HTMLElement | null;
}

let {
  pane,
  viewModel,
  actions,
  splitPickerFocusRoot = $bindable<HTMLElement | null>(null)
}: Props = $props();

// Local, read-only review-overlay toggle. Opened from the pending-proposal pill,
// closed by the overlay's own controls. Kept pane-local because it is purely a
// view toggle — the proposal state itself lives in the inbox session. Auto-closes
// when there is no longer a review model for the open note (e.g. note swapped or
// the proposal was approved/rejected in the inbox).
let isReviewOverlayOpen = $state(false);
$effect(() => {
  if (!viewModel.reviewOverlay) {
    isReviewOverlayOpen = false;
  }
});
</script>

<div
  bind:this={pane.refs.paneCard}
  class={viewModel.bodyClass}
  role="group"
  aria-label={viewModel.ariaLabel}
  onpointerdown={() => actions.onActivate(viewModel.paneId)}
  onfocusin={() => actions.onActivate(viewModel.paneId)}
>
  <div class={viewModel.frameClass}>
    <div class="notepad-editor-top-overlay absolute inset-x-0 top-0 z-20">
      <div class="pointer-events-none absolute inset-0 bg-card/58 backdrop-blur-sm" style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%);"></div>
      <div class="relative z-10 flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div class="h-9 w-9 shrink-0" aria-hidden="true"></div>
        <div class="pointer-events-none absolute inset-x-16 top-4 flex justify-center">
          <div bind:this={pane.refs.titleShell} class="pointer-events-auto w-full max-w-[24rem] min-w-0">
            <input
              bind:this={pane.refs.titleInput}
              type="text"
              class={viewModel.titleClass}
              placeholder={viewModel.titlePlaceholder}
              value={viewModel.titleValue}
              readonly={viewModel.titleReadonly}
              oninput={(event) => actions.onTitleInput(viewModel.paneId, event)}
              onblur={actions.onTitleBlur}
              onkeydown={actions.onTitleKeydown}
            />
          </div>
        </div>
        {#if viewModel.showCloseButton}
          <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void actions.onClose(viewModel.paneId)} aria-label="Close pane">
            <X class="h-4 w-4" />
          </button>
        {:else}
          <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void actions.onSplit()} aria-label="Add pane">
            <Columns2 class="h-4 w-4" />
          </button>
        {/if}
      </div>
    </div>

    {#if viewModel.isSplitPickerOpen}
      <div class="flex min-h-0 flex-1">
        <SplitPaneContentPicker
          bind:focusRoot={splitPickerFocusRoot}
          highlightedIndex={viewModel.splitPickerHighlightedIndex}
          currentNoteLabel={viewModel.splitPickerCurrentNoteLabel}
          previousNoteLabel={viewModel.splitPickerPreviousNoteLabel}
          onHighlightChange={actions.onSplitHighlightChange}
          onChoose={(choice) => void actions.onSplitChoose(viewModel.paneId, choice)}
        />
      </div>
    {:else if viewModel.paneKind === 'editor'}
      <div class="flex h-full flex-1 min-h-0 flex-col">
        {#if viewModel.pendingProposalNotice}
          <div class="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
            {#if viewModel.reviewOverlay}
              <button
                type="button"
                class="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 shadow-sm transition-colors hover:bg-amber-500/25"
                onclick={() => (isReviewOverlayOpen = true)}
              >
                <Inbox class="h-3.5 w-3.5" />
                {viewModel.pendingProposalNotice.changeCount === 1
                  ? 'Review AI change'
                  : `Review ${viewModel.pendingProposalNotice.changeCount} AI changes`}
              </button>
            {:else}
              <button
                type="button"
                class="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 shadow-sm transition-colors hover:bg-amber-500/25"
                onclick={() => void actions.onOpenInbox()}
              >
                <Inbox class="h-3.5 w-3.5" />
                {viewModel.pendingProposalNotice.changeCount === 1
                  ? 'AI change pending review'
                  : `${viewModel.pendingProposalNotice.changeCount} AI changes pending review`}
              </button>
            {/if}
          </div>
        {/if}
        {#if viewModel.reviewOverlay && isReviewOverlayOpen}
          {@const overlay = viewModel.reviewOverlay}
          <div class="absolute inset-0 z-30 flex flex-col bg-card/95 backdrop-blur-xl">
            <div class="flex items-start justify-between gap-3 border-b border-border/60 px-5 pt-5 pb-3">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-foreground">Review AI change</div>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Read-only preview · {overlay.opCounts.accepted}/{overlay.opCounts.total} block
                  {overlay.opCounts.total === 1 ? 'edit' : 'edits'} accepted in the inbox.
                  {#if overlay.titleChanged}
                    Rename: “{overlay.currentTitle}” → “{overlay.proposedTitle}”.
                  {/if}
                </p>
              </div>
              <button
                type="button"
                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onclick={() => (isReviewOverlayOpen = false)}
                aria-label="Close review"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-auto px-5 py-4">
              <MarkdownDiffView
                original={overlay.currentMarkdown}
                proposed={overlay.proposedMarkdown}
                collapseUnchanged
                maxHeightClass="max-h-none"
              />
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onclick={() => (isReviewOverlayOpen = false)}
              >
                Close
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                onclick={() => void actions.onOpenInbox()}
              >
                <Inbox class="h-3.5 w-3.5" />
                Decide in inbox
              </button>
            </div>
          </div>
        {/if}
        <div
          bind:this={pane.refs.editorShell}
          class="notepad-editor-shell relative h-full flex-1"
          class:notepad-editor-shell--slash-open={viewModel.isSlashMenuOpen}
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
            class="h-full min-h-full"
            use:editorAction={viewModel.editorLifecycle}
          ></div>
        </div>
      </div>
    {:else}
      <div class="flex min-h-0 flex-1 items-center justify-center px-6 pt-28 pb-16">
        <div class="max-w-md rounded-[1.6rem] border border-border/70 bg-background/60 px-6 py-5 text-left shadow-sm">
          <div class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">LLM Chat</div>
          <p class="mt-3 text-sm leading-7 text-muted-foreground">
            {viewModel.chatDescription}
          </p>
        </div>
      </div>
    {/if}
  </div>
</div>

<script lang="ts">
  import { Columns2, X } from 'lucide-svelte';
  import SplitPaneContentPicker from '$lib/features/notepad/SplitPaneContentPicker.svelte';
  import { editor as editorAction } from '$lib/features/notepad/editor/editorAction';
  import type { PaneRuntime } from '$lib/features/notepad/pane/paneRuntime.svelte';
  import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';
  import type { SplitChoice } from '$lib/features/notepad/splitPanePicker';

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
      <div class="h-full flex-1 min-h-0">
        <div
          bind:this={pane.refs.editorShell}
          class="notepad-editor-shell relative h-full"
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

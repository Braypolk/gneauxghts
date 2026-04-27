<script lang="ts">
  import { Columns2, X } from 'lucide-svelte';
  import SplitPaneContentPicker from '$lib/features/notepad/SplitPaneContentPicker.svelte';
  import type { SplitChoice } from '$lib/features/notepad/splitPanePicker';
  import type { NotepadPaneId } from '$lib/features/notepad/session/runtimeStore.svelte';

  type PaneKind = 'editor' | 'chat';

  interface Props {
    paneId: NotepadPaneId;
    ariaLabel: string;
    bodyClass: string;
    frameClass: string;
    paneKind: PaneKind;
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
    paneCard?: HTMLDivElement | null;
    editorShell?: HTMLDivElement | null;
    editorRoot?: HTMLDivElement | null;
    titleInput?: HTMLInputElement | null;
    titleShell?: HTMLDivElement | null;
    splitPickerFocusRoot?: HTMLElement | null;
    onActivate: (paneId: NotepadPaneId) => void;
    onClose: (paneId: NotepadPaneId) => void | Promise<void>;
    onSplit: () => void | Promise<void>;
    onTitleInput: (paneId: NotepadPaneId, event: Event) => void;
    onTitleBlur: () => void;
    onTitleKeydown: (event: KeyboardEvent) => void;
    onSplitHighlightChange: (index: number) => void;
    onSplitChoose: (paneId: NotepadPaneId, choice: SplitChoice) => void | Promise<void>;
  }

  let {
    paneId,
    ariaLabel,
    bodyClass,
    frameClass,
    paneKind,
    isEditorReady,
    isSlashMenuOpen,
    isSplitPickerOpen,
    showCloseButton,
    titleClass,
    titlePlaceholder,
    titleValue,
    titleReadonly,
    chatDescription,
    splitPickerHighlightedIndex,
    splitPickerCurrentNoteLabel,
    splitPickerPreviousNoteLabel,
    paneCard = $bindable<HTMLDivElement | null>(null),
    editorShell = $bindable<HTMLDivElement | null>(null),
    editorRoot = $bindable<HTMLDivElement | null>(null),
    titleInput = $bindable<HTMLInputElement | null>(null),
    titleShell = $bindable<HTMLDivElement | null>(null),
    splitPickerFocusRoot = $bindable<HTMLElement | null>(null),
    onActivate,
    onClose,
    onSplit,
    onTitleInput,
    onTitleBlur,
    onTitleKeydown,
    onSplitHighlightChange,
    onSplitChoose
  }: Props = $props();
</script>

<div
  bind:this={paneCard}
  class={bodyClass}
  role="group"
  aria-label={ariaLabel}
  onpointerdown={() => onActivate(paneId)}
  onfocusin={() => onActivate(paneId)}
>
  <div class={frameClass}>
    <div class="absolute inset-x-0 top-0 z-20">
      <div class="pointer-events-none absolute inset-0 bg-card/58 backdrop-blur-sm" style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%);"></div>
      <div class="relative z-10 flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div class="h-9 w-9 shrink-0" aria-hidden="true"></div>
        <div class="pointer-events-none absolute inset-x-16 top-4 flex justify-center">
          <div bind:this={titleShell} class="pointer-events-auto w-full max-w-[24rem] min-w-0">
            <input
              bind:this={titleInput}
              type="text"
              class={titleClass}
              placeholder={titlePlaceholder}
              value={titleValue}
              readonly={titleReadonly}
              oninput={(event) => onTitleInput(paneId, event)}
              onblur={onTitleBlur}
              onkeydown={onTitleKeydown}
            />
          </div>
        </div>
        {#if showCloseButton}
          <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void onClose(paneId)} aria-label="Close pane">
            <X class="h-4 w-4" />
          </button>
        {:else}
          <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/72 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onclick={() => void onSplit()} aria-label="Add pane">
            <Columns2 class="h-4 w-4" />
          </button>
        {/if}
      </div>
    </div>

    {#if isSplitPickerOpen}
      <div class="flex min-h-0 flex-1">
        <SplitPaneContentPicker
          bind:focusRoot={splitPickerFocusRoot}
          highlightedIndex={splitPickerHighlightedIndex}
          currentNoteLabel={splitPickerCurrentNoteLabel}
          previousNoteLabel={splitPickerPreviousNoteLabel}
          onHighlightChange={onSplitHighlightChange}
          onChoose={(choice) => void onSplitChoose(paneId, choice)}
        />
      </div>
    {:else if paneKind === 'editor'}
      <div class="h-full flex-1 min-h-0">
        <div
          bind:this={editorShell}
          class="notepad-editor-shell relative h-full"
          class:notepad-editor-shell--slash-open={isSlashMenuOpen}
        >
          {#if !isEditorReady}
            <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
                Loading editor
              </span>
            </div>
          {/if}

          <div bind:this={editorRoot} class="h-full min-h-full"></div>
        </div>
      </div>
    {:else}
      <div class="flex min-h-0 flex-1 items-center justify-center px-6 pt-28 pb-16">
        <div class="max-w-md rounded-[1.6rem] border border-border/70 bg-background/60 px-6 py-5 text-left shadow-sm">
          <div class="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">LLM Chat</div>
          <p class="mt-3 text-sm leading-7 text-muted-foreground">
            {chatDescription}
          </p>
        </div>
      </div>
    {/if}
  </div>
</div>

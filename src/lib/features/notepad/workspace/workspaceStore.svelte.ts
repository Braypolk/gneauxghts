import {
  notepadRuntimeState,
  type NotepadPaneId
} from '$lib/features/notepad/session/runtimeStore.svelte';
import { notepadState } from '$lib/features/notepad/session/runtimeStore.svelte';
import {
  setActivePane as setStoreActivePane,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import type { PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';

/**
 * Pane command UI state. The pane command overlay is shown while the user
 * chooses how to populate or repurpose a pane (typing, current note,
 * previous note, thought partner). It is workspace-level rather than
 * pane-local because only one pane can host the overlay at a time.
 */
export interface PaneCommandState {
  paneId: NotepadPaneId | null;
  sourceNoteKey: NoteKey | null;
  mode: PaneCommandMode;
  highlightedIndex: number;
  focusEl: HTMLElement | null;
}

/**
 * WorkspaceStore owns workspace-level pane state: pane order, active pane,
 * and pane command chrome. It mirrors notepadRuntimeState (which persists
 * across navigation) so that effects in Notepad.svelte don't have to track
 * the same state in multiple places.
 *
 * Methods mutate notepadState as needed so the noteStore stays in sync.
 */
export class WorkspaceStore {
  paneOrder = $state<NotepadPaneId[]>([...notepadRuntimeState.paneOrder]);
  activePaneId = $state<NotepadPaneId>(notepadRuntimeState.activePaneId);
  paneCommand = $state<PaneCommandState>({
    paneId: null,
    sourceNoteKey: null,
    mode: 'split',
    highlightedIndex: 0,
    focusEl: null
  });

  setPaneOrder(paneOrder: NotepadPaneId[]): void {
    this.paneOrder = paneOrder;
    notepadRuntimeState.paneOrder = paneOrder;
  }

  setActivePaneId(paneId: NotepadPaneId): void {
    this.activePaneId = paneId;
    notepadRuntimeState.activePaneId = paneId;
    setStoreActivePane(notepadState, paneId);
  }

  /** Insert paneId at end of paneOrder if not present. */
  ensurePaneVisible(paneId: NotepadPaneId): void {
    if (this.paneOrder.includes(paneId)) return;
    this.setPaneOrder([...this.paneOrder, paneId]);
  }

  removePane(paneId: NotepadPaneId): void {
    if (!this.paneOrder.includes(paneId)) return;
    this.setPaneOrder(this.paneOrder.filter((candidate) => candidate !== paneId));
  }

  beginPaneCommand(
    paneId: NotepadPaneId,
    sourceNoteKey: NoteKey,
    mode: PaneCommandMode
  ): void {
    this.paneCommand = {
      paneId,
      sourceNoteKey,
      mode,
      highlightedIndex: 0,
      focusEl: this.paneCommand.focusEl
    };
  }

  setPaneCommandHighlight(index: number): void {
    this.paneCommand = { ...this.paneCommand, highlightedIndex: index };
  }

  setPaneCommandFocusEl(el: HTMLElement | null): void {
    // Mutate the focusEl field in place rather than spreading and
    // reassigning paneCommand. The previous spread read this.paneCommand
    // before writing it, which trapped any caller wrapped in a Svelte
    // $effect into an effect_update_depth_exceeded loop (the read-write
    // pattern marks paneCommand as both a dep and a target). Mutation +
    // equality guard avoids both the dep-tracking read and redundant
    // invalidations.
    if (this.paneCommand.focusEl === el) return;
    this.paneCommand.focusEl = el;
  }

  resetPaneCommand(): void {
    this.paneCommand = {
      paneId: null,
      sourceNoteKey: null,
      mode: 'split',
      highlightedIndex: 0,
      focusEl: null
    };
  }
}

export const workspaceStore = new WorkspaceStore();
export type { NotepadPaneId };

import {
  notepadRuntimeState,
  PRIMARY_PANE_ID,
  SECONDARY_PANE_ID,
  type NotepadPaneId
} from '$lib/features/notepad/session/runtimeStore.svelte';
import { notepadState } from '$lib/features/notepad/session/runtimeStore.svelte';
import {
  setActivePane as setStoreActivePane,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';

/**
 * Split picker UI state. The split picker is a transient overlay shown in a
 * pane while the user picks how to populate it (current note / previous /
 * new / chat). It is workspace-level rather than pane-local because only
 * one pane can host the picker at a time, and Notepad.svelte already wired
 * its lifecycle.
 */
export interface SplitPickerState {
  paneId: NotepadPaneId | null;
  sourceNoteKey: NoteKey | null;
  highlightedIndex: number;
  focusEl: HTMLElement | null;
}

/**
 * WorkspaceStore owns workspace-level pane state: pane order, active pane,
 * and split picker chrome. It mirrors notepadRuntimeState (which persists
 * across navigation) so that effects in Notepad.svelte don't have to track
 * the same state in multiple places.
 *
 * Methods mutate notepadState as needed so the noteStore stays in sync.
 */
class WorkspaceStore {
  paneOrder = $state<NotepadPaneId[]>([...notepadRuntimeState.paneOrder]);
  activePaneId = $state<NotepadPaneId>(notepadRuntimeState.activePaneId);
  splitPicker = $state<SplitPickerState>({
    paneId: null,
    sourceNoteKey: null,
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

  beginSplitPicker(paneId: NotepadPaneId, sourceNoteKey: NoteKey): void {
    this.splitPicker = {
      paneId,
      sourceNoteKey,
      highlightedIndex: 0,
      focusEl: this.splitPicker.focusEl
    };
  }

  setSplitPickerHighlight(index: number): void {
    this.splitPicker = { ...this.splitPicker, highlightedIndex: index };
  }

  setSplitPickerFocusEl(el: HTMLElement | null): void {
    // Mutate the focusEl field in place rather than spreading and
    // reassigning splitPicker. The previous spread read this.splitPicker
    // before writing it, which trapped any caller wrapped in a Svelte
    // $effect into an effect_update_depth_exceeded loop (the read-write
    // pattern marks splitPicker as both a dep and a target). Mutation +
    // equality guard avoids both the dep-tracking read and redundant
    // invalidations.
    if (this.splitPicker.focusEl === el) return;
    this.splitPicker.focusEl = el;
  }

  resetSplitPicker(): void {
    this.splitPicker = {
      paneId: null,
      sourceNoteKey: null,
      highlightedIndex: 0,
      focusEl: null
    };
  }
}

export const workspaceStore = new WorkspaceStore();

export { PRIMARY_PANE_ID, SECONDARY_PANE_ID };
export type { NotepadPaneId };

import {
  INITIAL_PANE_ID,
  type NotepadPaneId
} from '$lib/features/notepad/session/runtimeStore.svelte';
import { initialNotepadNoteKey } from '$lib/features/notepad/state/noteState.svelte';
import type { NoteKey } from '$lib/features/notepad/state/noteStore';
import type { PaneCommandMode } from '$lib/features/notepad/paneCommandPicker';
import {
  canRemovePane as policyCanRemovePane,
  canSetPaneKind,
  paneHasCapability
} from './paneCapabilities';
import type {
  PaneKind,
  WorkspacePaneState
} from './paneTypes';

/**
 * Pane command UI state. The pane command overlay is shown while the user
 * chooses how to populate or repurpose a pane (typing, current location,
 * previous location, thought partner). It is workspace-level rather than
 * pane-local because only one pane can host the overlay at a time.
 */
export interface PaneCommandState {
  paneId: NotepadPaneId | null;
  sourcePaneId: NotepadPaneId | null;
  sourceNoteKey: NoteKey | null;
  mode: PaneCommandMode;
  highlightedIndex: number;
  focusEl: HTMLElement | null;
}

/**
 * Sole owner of workspace pane structure and pane-to-content references.
 * Document bodies live in noteState; pane runtimes live separately.
 */
export class WorkspaceStore {
  paneOrder = $state<NotepadPaneId[]>([]);
  activePaneId = $state<NotepadPaneId>(INITIAL_PANE_ID);
  panesById = $state<
    Partial<Record<NotepadPaneId, WorkspacePaneState<NotepadPaneId>>>
  >({});
  paneCommand = $state<PaneCommandState>({
    paneId: null,
    sourcePaneId: null,
    sourceNoteKey: null,
    mode: 'split',
    highlightedIndex: 0,
    focusEl: null
  });

  constructor(
    initialPaneId: NotepadPaneId = INITIAL_PANE_ID,
    initialNoteKey: NoteKey = initialNotepadNoteKey
  ) {
    this.paneOrder = [initialPaneId];
    this.activePaneId = initialPaneId;
    this.panesById = {
      [initialPaneId]: {
        paneId: initialPaneId,
        kind: 'editor',
        noteKey: initialNoteKey,
        chatConversationId: null
      }
    };
    this.assertInvariants();
  }

  getPaneState(
    paneId: NotepadPaneId
  ): WorkspacePaneState<NotepadPaneId> {
    const pane = this.panesById[paneId];
    if (!pane) {
      throw new Error(`Unknown workspace pane: ${paneId}`);
    }
    return pane;
  }

  hasPane(paneId: NotepadPaneId): boolean {
    return Boolean(this.panesById[paneId]);
  }

  setActivePaneId = (paneId: NotepadPaneId): void => {
    this.getPaneState(paneId);
    this.activePaneId = paneId;
    this.assertInvariants();
  };

  addPane(
    paneId: NotepadPaneId,
    noteKey: NoteKey,
    kind: PaneKind = 'editor'
  ): WorkspacePaneState<NotepadPaneId> {
    if (this.hasPane(paneId)) {
      throw new Error(`Workspace pane already exists: ${paneId}`);
    }
    const pane: WorkspacePaneState<NotepadPaneId> = {
      paneId,
      kind,
      noteKey,
      chatConversationId: null
    };
    this.panesById[paneId] = pane;
    this.paneOrder = [...this.paneOrder, paneId];
    this.assertInvariants();
    return pane;
  }

  canRemovePane(paneId: NotepadPaneId): boolean {
    return policyCanRemovePane(
      {
        paneOrder: this.paneOrder,
        getPaneKind: (candidate) =>
          this.getPaneState(candidate).kind
      },
      paneId
    );
  }

  removePane(
    paneId: NotepadPaneId
  ): WorkspacePaneState<NotepadPaneId> | null {
    if (!this.canRemovePane(paneId)) return null;

    const pane = this.getPaneState(paneId);
    const index = this.paneOrder.indexOf(paneId);
    const adjacentPaneId =
      this.paneOrder[index + 1] ??
      this.paneOrder[index - 1];
    this.paneOrder = this.paneOrder.filter(
      (candidate) => candidate !== paneId
    );
    delete this.panesById[paneId];
    if (this.activePaneId === paneId && adjacentPaneId) {
      this.activePaneId = adjacentPaneId;
    }
    this.assertInvariants();
    return pane;
  }

  setPaneKind(
    paneId: NotepadPaneId,
    kind: PaneKind
  ): boolean {
    const pane = this.getPaneState(paneId);
    if (pane.kind === kind) return true;
    if (
      !canSetPaneKind(
        {
          paneOrder: this.paneOrder,
          getPaneKind: (candidate) =>
            this.getPaneState(candidate).kind
        },
        paneId,
        kind
      )
    ) {
      return false;
    }
    pane.kind = kind;
    if (kind === 'editor') {
      pane.chatConversationId = null;
    }
    this.assertInvariants();
    return true;
  }

  setPaneNoteKey(
    paneId: NotepadPaneId,
    noteKey: NoteKey
  ): void {
    this.getPaneState(paneId).noteKey = noteKey;
    this.assertInvariants();
  }

  setPaneConversationId(
    paneId: NotepadPaneId,
    conversationId: string | null
  ): void {
    this.getPaneState(paneId).chatConversationId =
      conversationId;
    this.assertInvariants();
  }

  replaceNoteKeyReferences(
    previousKey: NoteKey,
    nextKey: NoteKey
  ): void {
    for (const paneId of this.paneOrder) {
      const pane = this.getPaneState(paneId);
      if (pane.noteKey === previousKey) {
        pane.noteKey = nextKey;
      }
    }
    this.assertInvariants();
  }

  isNoteReferenced(noteKey: NoteKey): boolean {
    return this.paneOrder.some(
      (paneId) =>
        this.getPaneState(paneId).noteKey === noteKey
    );
  }

  listReferencedNoteKeys(): NoteKey[] {
    return [
      ...new Set(
        this.paneOrder.map(
          (paneId) => this.getPaneState(paneId).noteKey
        )
      )
    ];
  }

  assertInvariants(): void {
    if (this.paneOrder.length === 0) {
      throw new Error('Workspace must contain at least one pane.');
    }
    if (new Set(this.paneOrder).size !== this.paneOrder.length) {
      throw new Error('Workspace pane order must be unique.');
    }
    if (!this.paneOrder.includes(this.activePaneId)) {
      throw new Error('Active pane must be visible.');
    }
    for (const paneId of this.paneOrder) {
      if (!this.panesById[paneId]) {
        throw new Error(
          `Visible pane is missing state: ${paneId}`
        );
      }
    }
    const storedPaneIds = Object.keys(this.panesById).filter(
      (paneId) =>
        Boolean(
          this.panesById[paneId as NotepadPaneId]
        )
    ) as NotepadPaneId[];
    if (
      storedPaneIds.length !== this.paneOrder.length ||
      storedPaneIds.some(
        (paneId) => !this.paneOrder.includes(paneId)
      )
    ) {
      throw new Error(
        'Workspace pane records must match pane order.'
      );
    }
    if (
      !this.paneOrder.some(
        (paneId) =>
          paneHasCapability(
            this.getPaneState(paneId).kind,
            'edit-document'
          )
      )
    ) {
      throw new Error(
        'Workspace must contain at least one editor.'
      );
    }
  }

  beginPaneCommand(
    paneId: NotepadPaneId,
    sourceNoteKey: NoteKey,
    mode: PaneCommandMode,
    sourcePaneId: NotepadPaneId = paneId
  ): void {
    this.paneCommand = {
      paneId,
      sourcePaneId,
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
      sourcePaneId: null,
      sourceNoteKey: null,
      mode: 'split',
      highlightedIndex: 0,
      focusEl: null
    };
  }
}

export const workspaceStore = new WorkspaceStore();
export type { NotepadPaneId };

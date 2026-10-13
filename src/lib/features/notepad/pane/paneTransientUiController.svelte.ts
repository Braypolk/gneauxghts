import type { EditorView } from '@codemirror/view';
import type { ImageViewerSession } from '../images/imageViewerModel';
import type { ExternalLinkActionsSession } from '../editor/externalLinkExtension';
import type { EditorCapabilityAdapter } from '$lib/features/notepad/editor/editorCapabilities';
import {
  slashMenuHideFromUi,
  type SlashMenuSnapshot
} from '$lib/features/notepad/editor/slashMenu';
import {
  selectionMenuHideFromUi,
  type SelectionMenuSnapshot
} from '$lib/features/notepad/editor/selectionMenu';
import type { PaneRuntime } from './paneRuntime.svelte';
import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import type { WikilinkAutocompleteState } from '$lib/features/notepad/wikilinks/state';
import {
  getPaneIdForSlashMenuView,
  setSlashMenuListener
} from '$lib/features/notepad/editor/slashMenuBridge';
import {
  getPaneIdForSelectionMenuView,
  setSelectionMenuListener
} from '$lib/features/notepad/editor/selectionMenuBridge';
import {
  transitionPaneTransientUi,
  type PaneTransientUiAction,
  type PaneTransientUiState
} from './paneTransientUiState';

interface WikilinkController {
  closeWikilinkAutocomplete: () => void;
  handleActiveWikilinkChange: (value: ActiveWikilink | null) => void;
}

export interface PaneTransientUiDeps<TPaneId extends string> {
  getActivePaneId: () => TPaneId;
  getVisiblePaneIds: () => TPaneId[];
  getPaneRuntime: (paneId: TPaneId) => PaneRuntime;
  getEditorCapabilities: (
    paneId: TPaneId
  ) => EditorCapabilityAdapter | null;
  getWikilinkController: (paneId: TPaneId) => WikilinkController;
}

/** Mutual exclusion and pane ownership for editor transient UI. */
export class PaneTransientUiController<TPaneId extends string> {
  active = $state.raw<PaneTransientUiState<TPaneId>>({
    kind: 'none'
  });

  constructor(private readonly deps: PaneTransientUiDeps<TPaneId>) {}

  private transition(action: PaneTransientUiAction<TPaneId>) {
    const current = this.active;
    const next = transitionPaneTransientUi<TPaneId>(current, action);
    // Closed menu notifications during modal teardown must not republish the
    // unchanged surface from the retiring component's reactive snapshot.
    if (next !== current) this.active = next;
  }

  openImageViewer(paneId: TPaneId, session: ImageViewerSession) {
    this.closeExternalLinkActions();
    this.closeImageViewer();
    this.closeSlashMenu(); this.closeSelectionMenu(); this.closeWikilinkAutocomplete();
    this.transition({ type: 'open-image-viewer', paneId, session });
  }

  closeImageViewer(paneId: TPaneId | null = null) {
    this.transition({ type: 'close', kind: 'image-viewer', paneId });
  }

  openExternalLinkActions(paneId: TPaneId, session: ExternalLinkActionsSession) {
    this.closeImageViewer();
    this.closeSlashMenu();
    this.closeSelectionMenu();
    this.closeWikilinkAutocomplete();
    this.transition({ type: 'open-external-link-actions', paneId, session });
  }

  closeExternalLinkActions(paneId: TPaneId | null = null) {
    this.transition({ type: 'close', kind: 'external-link-actions', paneId });
  }

  registerBridgeListeners(
    resolvePaneId: (paneKey: string) => TPaneId | null
  ) {
    setSlashMenuListener((view, snapshot) => {
      const paneKey = getPaneIdForSlashMenuView(view);
      const paneId = paneKey ? resolvePaneId(paneKey) : null;
      if (paneId) {
        this.applySlashMenuSnapshot(paneId, snapshot, view);
      }
    });
    setSelectionMenuListener((view, snapshot) => {
      const paneKey = getPaneIdForSelectionMenuView(view);
      const paneId = paneKey ? resolvePaneId(paneKey) : null;
      if (paneId) {
        this.applySelectionMenuSnapshot(paneId, snapshot, view);
      }
    });
    return () => {
      setSlashMenuListener(null);
      setSelectionMenuListener(null);
    };
  }

  closeSelectionMenu(paneId: TPaneId | null = null) {
    const paneIds = paneId ? [paneId] : this.deps.getVisiblePaneIds();
    for (const id of paneIds) {
      this.deps.getEditorCapabilities(id)?.closeSelectionMenu();
      this.deps.getPaneRuntime(id).setSelectionMenu({ open: false });
    }
    this.transition({
        type: 'close',
        kind: 'selection-menu',
        paneId
      }
    );
  }

  closeSlashMenu(paneId: TPaneId | null = null) {
    const paneIds = paneId ? [paneId] : this.deps.getVisiblePaneIds();
    for (const id of paneIds) {
      this.deps.getEditorCapabilities(id)?.closeSlashMenu();
      this.deps.getPaneRuntime(id).setSlashMenu({ open: false });
    }
    this.transition({
        type: 'close',
        kind: 'slash-menu',
        paneId
      }
    );
  }

  closeWikilinkAutocomplete(paneId: TPaneId | null = null) {
    if (paneId) {
      this.deps.getWikilinkController(paneId).closeWikilinkAutocomplete();
      this.transition({
          type: 'close',
          kind: 'wikilink-autocomplete',
          paneId
        }
      );
      return;
    }
    for (const id of this.deps.getVisiblePaneIds()) {
      this.deps.getWikilinkController(id).closeWikilinkAutocomplete();
    }
    this.transition({
        type: 'close',
        kind: 'wikilink-autocomplete'
      }
    );
  }

  closeExcept(paneId: TPaneId) {
    for (const id of this.deps.getVisiblePaneIds()) {
      if (id === paneId) continue;
      this.deps.getEditorCapabilities(id)?.closeDatePicker();
      this.closeExternalLinkActions(id);
      this.closeImageViewer(id);
      this.closeSlashMenu(id);
      this.closeSelectionMenu(id);
      this.closeWikilinkAutocomplete(id);
    }
  }

  applySlashMenuSnapshot(
    paneId: TPaneId,
    snapshot: SlashMenuSnapshot,
    view: EditorView
  ) {
    if (!snapshot.open) {
      this.deps.getPaneRuntime(paneId).setSlashMenu({ open: false });
      this.transition({
          type: 'close',
          kind: 'slash-menu',
          paneId
        }
      );
      return;
    }
    if (paneId !== this.deps.getActivePaneId()) {
      slashMenuHideFromUi(view);
      this.deps.getPaneRuntime(paneId).setSlashMenu({ open: false });
      return;
    }
    for (const id of this.deps.getVisiblePaneIds()) {
      if (id !== paneId) this.closeSlashMenu(id);
    }
    this.closeWikilinkAutocomplete();
    this.closeImageViewer();
    this.closeExternalLinkActions();
    this.transition({
        type: 'open',
        kind: 'slash-menu',
        paneId
      }
    );
    this.deps.getPaneRuntime(paneId).setSlashMenu({
      open: true,
      view,
      anchorPos: snapshot.anchorPos,
      groups: snapshot.groups,
      hoverIndex: snapshot.hoverIndex
    });
    this.closeSelectionMenu(paneId);
  }

  applySelectionMenuSnapshot(
    paneId: TPaneId,
    snapshot: SelectionMenuSnapshot,
    view: EditorView
  ) {
    if (!snapshot.open) {
      this.deps.getPaneRuntime(paneId).setSelectionMenu({ open: false });
      this.transition({
          type: 'close',
          kind: 'selection-menu',
          paneId
        }
      );
      return;
    }
    if (paneId !== this.deps.getActivePaneId()) {
      selectionMenuHideFromUi(view);
      this.deps.getPaneRuntime(paneId).setSelectionMenu({ open: false });
      return;
    }
    for (const id of this.deps.getVisiblePaneIds()) {
      if (id !== paneId) this.closeSelectionMenu(id);
    }
    this.closeWikilinkAutocomplete();
    this.closeImageViewer();
    this.closeExternalLinkActions();
    this.closeSlashMenu(paneId);
    this.transition({
        type: 'open',
        kind: 'selection-menu',
        paneId
      }
    );
    this.deps.getPaneRuntime(paneId).setSelectionMenu({
      open: true,
      view,
      selectionFrom: snapshot.selectionFrom,
      selectionTo: snapshot.selectionTo,
      groups: snapshot.groups,
      hoverIndex: snapshot.hoverIndex,
      blockPanelOpen: snapshot.blockPanelOpen,
      activeInlineFormats: snapshot.activeInlineFormats
    });
  }

  updateWikilinkState(paneId: TPaneId, next: WikilinkAutocompleteState) {
    if (next.active) {
      this.closeExternalLinkActions();
      this.closeImageViewer();
      this.closeSlashMenu();
      this.closeSelectionMenu();
      for (const id of this.deps.getVisiblePaneIds()) {
        if (id !== paneId) this.closeWikilinkAutocomplete(id);
      }
    }
    this.deps.getPaneRuntime(paneId).setWikilinkAutocomplete(next);
    this.transition(next.active
      ? { type: 'open', kind: 'wikilink-autocomplete', paneId }
      : { type: 'close', kind: 'wikilink-autocomplete', paneId });
  }

  handleActiveWikilinkChange(
    paneId: TPaneId,
    activeWikilink: ActiveWikilink | null
  ) {
    this.deps
      .getWikilinkController(paneId)
      .handleActiveWikilinkChange(activeWikilink);
  }
}

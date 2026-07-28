import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import type { WikilinkAutocompleteState } from '$lib/features/notepad/wikilinks/state';

interface WikilinkControllerPort {
  handleAutocompleteKeydown: (event: KeyboardEvent) => boolean;
  openWikilink: (rawTarget: string) => Promise<void>;
  selectWikilinkSuggestion: (value: string) => void;
}

interface TransientUiPort<TPaneId extends string> {
  updateWikilinkState: (
    paneId: TPaneId,
    state: WikilinkAutocompleteState
  ) => void;
  closeSelectionMenu: (paneId?: TPaneId | null) => void;
  closeSlashMenu: (paneId?: TPaneId | null) => void;
  closeExcept: (paneId: TPaneId) => void;
  closeWikilinkAutocomplete: (
    paneId?: TPaneId | null
  ) => void;
  handleActiveWikilinkChange: (
    paneId: TPaneId,
    activeWikilink: ActiveWikilink | null
  ) => void;
}

export interface WikilinkInteractionControllerDeps<
  TPaneId extends string
> {
  transientUi: TransientUiPort<TPaneId>;
  getPaneCommandPaneId: () => TPaneId | null;
  getNavigationPaneId: () => TPaneId;
  getWikilinkController: (
    paneId: TPaneId
  ) => WikilinkControllerPort;
  setActivePane: (paneId: TPaneId) => void;
  openChatProjection: (
    paneId: TPaneId,
    path: string
  ) => Promise<boolean>;
  getWikilinkState: (
    paneId: TPaneId
  ) => WikilinkAutocompleteState;
}

/** Coordinates wikilink routing with the single transient-menu owner. */
export function createWikilinkInteractionController<
  TPaneId extends string
>(deps: WikilinkInteractionControllerDeps<TPaneId>) {
  const updatePaneWikilinkState =
    deps.transientUi.updateWikilinkState.bind(
      deps.transientUi
    );
  const closeSelectionMenu =
    deps.transientUi.closeSelectionMenu.bind(
      deps.transientUi
    );
  const closeSlashMenu =
    deps.transientUi.closeSlashMenu.bind(deps.transientUi);
  const closeTransientUiExcept =
    deps.transientUi.closeExcept.bind(deps.transientUi);
  const closeWikilinkAutocomplete =
    deps.transientUi.closeWikilinkAutocomplete.bind(
      deps.transientUi
    );
  const handleActiveWikilinkChange =
    deps.transientUi.handleActiveWikilinkChange.bind(
      deps.transientUi
    );

  function handleWikilinkKeydown(event: KeyboardEvent) {
    if (deps.getPaneCommandPaneId() !== null) {
      return false;
    }
    return deps
      .getWikilinkController(deps.getNavigationPaneId())
      .handleAutocompleteKeydown(event);
  }

  async function openWikilink(
    paneId: TPaneId,
    rawTarget: string
  ) {
    deps.setActivePane(paneId);
    if (
      rawTarget.replaceAll('\\', '/').startsWith('Chats/')
    ) {
      const path = rawTarget.split('#', 1)[0];
      if (
        await deps.openChatProjection(
          paneId,
          path.endsWith('.md') ? path : `${path}.md`
        )
      ) {
        return;
      }
    }
    await deps
      .getWikilinkController(paneId)
      .openWikilink(rawTarget);
  }

  function handleWikilinkSuggestionSelect(
    paneId: TPaneId,
    value: string
  ) {
    const state = deps.getWikilinkState(paneId);
    const selectedIndex = state.suggestions.findIndex(
      (suggestion) => suggestion.value === value
    );
    if (selectedIndex === -1) return;

    updatePaneWikilinkState(paneId, {
      ...state,
      selectedIndex
    });
    deps
      .getWikilinkController(paneId)
      .selectWikilinkSuggestion(value);
  }

  return {
    updatePaneWikilinkState,
    closeSelectionMenu,
    closeSlashMenu,
    closeTransientUiExcept,
    closeWikilinkAutocomplete,
    handleActiveWikilinkChange,
    handleWikilinkKeydown,
    openWikilink,
    handleWikilinkSuggestionSelect
  };
}

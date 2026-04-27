import { get, writable } from 'svelte/store';
import type { RelatedNoteItem, RelatedNotesResponse } from '$lib/types/semantic';
import { getRelatedNotes } from '$lib/features/notepad/search/search';
import {
  buildRelatedRequestKey,
  computeRelatedDrawerLayout,
  EMPTY_RELATED_REASON,
  getEditorSelectionText,
  getRelatedAssessmentDelay,
  normalizeRelatedText,
  type RelatedScope
} from '$lib/features/notepad/related/layout';

export interface RelatedNotesState {
  items: RelatedNoteItem[];
  status: RelatedNotesResponse['status'];
  reason: string | null;
  scope: RelatedScope;
  panelPlacement: 'side' | 'bottom';
  isLoading: boolean;
  selectedText: string | null;
  isPanelCollapsed: boolean;
  reservedWidth: number;
}

interface RelatedStoreDeps {
  getCurrentTitle: () => string;
  getCurrentMarkdown: () => string;
  getCurrentPath: () => string | null;
}

function createInitialState(): RelatedNotesState {
  return {
    items: [],
    status: 'insufficientContent',
    reason: EMPTY_RELATED_REASON,
    scope: 'note',
    panelPlacement: 'side',
    isLoading: false,
    selectedText: null,
    isPanelCollapsed: true,
    reservedWidth: 0
  };
}

export function createRelatedNotesStore({
  getCurrentTitle,
  getCurrentMarkdown,
  getCurrentPath
}: RelatedStoreDeps) {
  const store = writable<RelatedNotesState>(createInitialState());
  const { subscribe, update } = store;
  let relatedTimer: ReturnType<typeof window.setTimeout> | null = null;
  let activeRelatedRequest = 0;
  let lastRelatedRequestKey = '';

  function patch(partial: Partial<RelatedNotesState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function updateDrawerLayout(shellEl: HTMLDivElement | null) {
    if (!shellEl || typeof window === 'undefined') {
      return;
    }

    const layout = computeRelatedDrawerLayout(shellEl, get(store).isPanelCollapsed);
    patch({
      panelPlacement: layout.placement,
      reservedWidth: layout.reservedWidth
    });
  }

  function resetRelatedResults(
    status: RelatedNotesResponse['status'] = 'insufficientContent',
    reason: string | null = EMPTY_RELATED_REASON
  ) {
    patch({
      items: [],
      status,
      reason,
      isLoading: false
    });
    lastRelatedRequestKey = '';
  }

  function cancelRelatedAssessment() {
    if (relatedTimer) {
      window.clearTimeout(relatedTimer);
      relatedTimer = null;
    }

    activeRelatedRequest += 1;
    patch({ isLoading: false });
  }

  function getActiveRelatedSelectionText() {
    const state = get(store);
    return state.scope === 'selection' ? state.selectedText : null;
  }

  function isSelectionInsideEditorRoot(editorRoot: HTMLDivElement | null) {
    const selection = window.getSelection();
    if (!selection || !editorRoot) {
      return false;
    }

    const anchorNode =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement ?? null;
    const focusNode =
      selection.focusNode instanceof Element
        ? selection.focusNode
        : selection.focusNode?.parentElement ?? null;

    return (
      !!anchorNode &&
      !!focusNode &&
      editorRoot.contains(anchorNode) &&
      editorRoot.contains(focusNode)
    );
  }

  function updateSelectedRelatedText(editorRoot: HTMLDivElement | null) {
    if (!isSelectionInsideEditorRoot(editorRoot)) {
      return;
    }

    const nextSelection = getEditorSelectionText(editorRoot);
    const previousSelection = get(store).selectedText;
    if (nextSelection === previousSelection) {
      return;
    }

    const hadSelection = !!previousSelection;
    patch({
      selectedText: nextSelection,
      scope: nextSelection && !hadSelection ? 'selection' : !nextSelection ? 'note' : get(store).scope
    });
    scheduleRelated({ immediate: true });
  }

  function clearSelectedRelatedText() {
    patch({
      selectedText: null,
      scope: 'note'
    });
  }

  function scheduleRelated({ immediate = false }: { immediate?: boolean } = {}) {
    if (relatedTimer) {
      window.clearTimeout(relatedTimer);
      relatedTimer = null;
    }

    const state = get(store);
    if (state.isPanelCollapsed) {
      patch({ isLoading: false });
      return;
    }

    const activeSelection = getActiveRelatedSelectionText();

    if (state.scope === 'selection' && !activeSelection) {
      resetRelatedResults();
      return;
    }

    const delay = activeSelection
      ? getRelatedAssessmentDelay(normalizeRelatedText(activeSelection).length, immediate, true)
      : getRelatedAssessmentDelay(0, immediate, false);
    relatedTimer = window.setTimeout(() => {
      relatedTimer = null;
      void runRelatedNotes();
    }, delay);
  }

  async function runRelatedNotes() {
    const state = get(store);
    if (state.isPanelCollapsed) {
      patch({ isLoading: false });
      return;
    }

    const selectedText = getActiveRelatedSelectionText();
    if (state.scope === 'selection' && !selectedText) {
      resetRelatedResults();
      return;
    }

    const markdown = getCurrentMarkdown();
    const normalizedContent = normalizeRelatedText(selectedText ?? markdown);
    if (normalizedContent === '') {
      resetRelatedResults();
      return;
    }

    const requestKey = buildRelatedRequestKey(
      getCurrentPath(),
      state.scope,
      getCurrentTitle(),
      markdown,
      selectedText
    );

    if (requestKey === lastRelatedRequestKey) {
      return;
    }

    const requestId = ++activeRelatedRequest;
    patch({ isLoading: true });

    try {
      const response = await getRelatedNotes(
        {
          currentPath: getCurrentPath(),
          currentTitle: getCurrentTitle(),
          currentMarkdown: markdown
        },
        selectedText,
        4
      );

      if (requestId !== activeRelatedRequest) {
        return;
      }

      patch({
        items: response.items,
        status: response.status,
        reason: response.reason
      });
      lastRelatedRequestKey = requestKey;
    } catch (error) {
      if (requestId !== activeRelatedRequest) {
        return;
      }

      console.error('Failed to load related notes:', error);
      patch({
        items: [],
        status: 'unavailable',
        reason: 'Related notes are unavailable right now.'
      });
      lastRelatedRequestKey = '';
    } finally {
      if (requestId === activeRelatedRequest) {
        patch({ isLoading: false });
      }
    }
  }

  function handleRelatedScopeChange(scope: RelatedScope) {
    if (scope === 'selection' && !get(store).selectedText) {
      return;
    }

    patch({ scope });
    scheduleRelated({ immediate: true });
  }

  function toggleRelatedPanel(shellEl: HTMLDivElement | null) {
    patch({ isPanelCollapsed: !get(store).isPanelCollapsed });
    updateDrawerLayout(shellEl);

    if (get(store).isPanelCollapsed) {
      cancelRelatedAssessment();
      return;
    }

    scheduleRelated({ immediate: true });
  }

  function dispose() {
    cancelRelatedAssessment();
  }

  return {
    subscribe,
    updateDrawerLayout,
    resetRelatedResults,
    cancelRelatedAssessment,
    updateSelectedRelatedText,
    clearSelectedRelatedText,
    scheduleRelated,
    runRelatedNotes,
    handleRelatedScopeChange,
    toggleRelatedPanel,
    dispose
  };
}

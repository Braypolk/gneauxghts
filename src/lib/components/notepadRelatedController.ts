import type { RelatedNoteItem, RelatedNotesResponse } from '$lib/types/semantic';
import { getRelatedNotes } from './notepadSearch';
import {
  buildRelatedRequestKey,
  computeRelatedDrawerLayout,
  EMPTY_RELATED_REASON,
  getEditorSelectionText,
  getRelatedAssessmentDelay,
  normalizeRelatedText,
  type RelatedScope
} from './notepadRelated';

interface NotepadRelatedControllerDeps {
  getCurrentMarkdown: () => string;
  getCurrentPath: () => string | null;
  getScope: () => RelatedScope;
  setScope: (scope: RelatedScope) => void;
  getSelectedText: () => string | null;
  setSelectedText: (value: string | null) => void;
  isPanelCollapsed: () => boolean;
  setPanelCollapsed: (value: boolean) => void;
  setPanelLayout: (placement: 'side' | 'bottom', reservedWidth: number) => void;
  setItems: (items: RelatedNoteItem[]) => void;
  setStatus: (status: RelatedNotesResponse['status']) => void;
  setReason: (reason: string | null) => void;
  setIsLoading: (value: boolean) => void;
}

export function createNotepadRelatedController({
  getCurrentMarkdown,
  getCurrentPath,
  getScope,
  setScope,
  getSelectedText,
  setSelectedText,
  isPanelCollapsed,
  setPanelCollapsed,
  setPanelLayout,
  setItems,
  setStatus,
  setReason,
  setIsLoading
}: NotepadRelatedControllerDeps) {
  let relatedTimer: ReturnType<typeof window.setTimeout> | null = null;
  let activeRelatedRequest = 0;
  let lastRelatedRequestKey = '';

  function updateDrawerLayout(notepadShell: HTMLDivElement | null) {
    if (!notepadShell || typeof window === 'undefined') {
      return;
    }

    const layout = computeRelatedDrawerLayout(notepadShell, isPanelCollapsed());
    setPanelLayout(layout.placement, layout.reservedWidth);
  }

  function resetRelatedResults(
    status: RelatedNotesResponse['status'] = 'insufficientContent',
    reason: string | null = EMPTY_RELATED_REASON
  ) {
    setItems([]);
    setStatus(status);
    setReason(reason);
    setIsLoading(false);
    lastRelatedRequestKey = '';
  }

  function cancelRelatedAssessment() {
    if (relatedTimer) {
      window.clearTimeout(relatedTimer);
      relatedTimer = null;
    }

    activeRelatedRequest += 1;
    setIsLoading(false);
  }

  function getActiveRelatedSelectionText() {
    return getScope() === 'selection' ? getSelectedText() : null;
  }

  function updateSelectedRelatedText(editorRoot: HTMLDivElement | null) {
    const nextSelection = getEditorSelectionText(editorRoot);
    if (nextSelection === getSelectedText()) {
      return;
    }

    const hadSelection = !!getSelectedText();
    setSelectedText(nextSelection);

    if (nextSelection && !hadSelection) {
      setScope('selection');
    } else if (!nextSelection) {
      setScope('note');
    }

    scheduleRelated({ immediate: true });
  }

  function clearSelectedRelatedText() {
    setSelectedText(null);
    setScope('note');
  }

  function scheduleRelated({ immediate = false }: { immediate?: boolean } = {}) {
    if (relatedTimer) {
      window.clearTimeout(relatedTimer);
      relatedTimer = null;
    }

    if (isPanelCollapsed()) {
      setIsLoading(false);
      return;
    }

    const markdown = getCurrentMarkdown();
    const activeSelection = getActiveRelatedSelectionText();
    const normalizedContent = normalizeRelatedText(activeSelection ?? markdown);

    if (normalizedContent === '' || (getScope() === 'selection' && !activeSelection)) {
      resetRelatedResults();
      return;
    }

    const delay = getRelatedAssessmentDelay(
      normalizedContent.length,
      immediate,
      !!activeSelection
    );

    relatedTimer = window.setTimeout(() => {
      relatedTimer = null;
      void runRelatedNotes();
    }, delay);
  }

  async function runRelatedNotes() {
    if (isPanelCollapsed()) {
      setIsLoading(false);
      return;
    }

    const markdown = getCurrentMarkdown();
    const selectedText = getActiveRelatedSelectionText();
    const requestKey = buildRelatedRequestKey(
      getCurrentPath(),
      getScope(),
      markdown,
      selectedText
    );

    if (requestKey === lastRelatedRequestKey) {
      return;
    }

    const requestId = ++activeRelatedRequest;
    setIsLoading(true);

    try {
      const response = await getRelatedNotes(
        {
          currentPath: getCurrentPath(),
          currentMarkdown: markdown
        },
        selectedText,
        4
      );

      if (requestId !== activeRelatedRequest) {
        return;
      }

      setItems(response.items);
      setStatus(response.status);
      setReason(response.reason);
      lastRelatedRequestKey = requestKey;
    } catch (error) {
      if (requestId !== activeRelatedRequest) {
        return;
      }

      console.error('Failed to load related notes:', error);
      setItems([]);
      setStatus('unavailable');
      setReason('Related notes are unavailable right now.');
      lastRelatedRequestKey = '';
    } finally {
      if (requestId === activeRelatedRequest) {
        setIsLoading(false);
      }
    }
  }

  function handleRelatedScopeChange(scope: RelatedScope) {
    if (scope === 'selection' && !getSelectedText()) {
      return;
    }

    setScope(scope);
    scheduleRelated({ immediate: true });
  }

  function toggleRelatedPanel(notepadShell: HTMLDivElement | null) {
    setPanelCollapsed(!isPanelCollapsed());
    updateDrawerLayout(notepadShell);
    if (isPanelCollapsed()) {
      cancelRelatedAssessment();
      return;
    }

    scheduleRelated({ immediate: true });
  }

  function dispose() {
    cancelRelatedAssessment();
  }

  return {
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

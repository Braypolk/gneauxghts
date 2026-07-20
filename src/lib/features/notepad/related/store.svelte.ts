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

export class RelatedNotesStore {
  items = $state<RelatedNoteItem[]>([]);
  status = $state<RelatedNotesResponse['status']>('insufficientContent');
  reason = $state<string | null>(EMPTY_RELATED_REASON);
  scope = $state<RelatedScope>('note');
  panelPlacement = $state<'side' | 'bottom'>('side');
  isLoading = $state(false);
  selectedText = $state<string | null>(null);
  isPanelCollapsed = $state(true);
  reservedWidth = $state(0);

  #deps: RelatedStoreDeps;
  #relatedTimer: number | null = null;
  #activeRelatedRequest = 0;
  #lastRelatedRequestKey = '';

  constructor(deps: RelatedStoreDeps) {
    this.#deps = deps;
  }

  updateDrawerLayout = (shellEl: HTMLDivElement | null) => {
    if (!shellEl || typeof window === 'undefined') {
      return;
    }

    const layout = computeRelatedDrawerLayout(shellEl, this.isPanelCollapsed);
    this.panelPlacement = layout.placement;
    this.reservedWidth = layout.reservedWidth;
  };

  resetRelatedResults = (
    status: RelatedNotesResponse['status'] = 'insufficientContent',
    reason: string | null = EMPTY_RELATED_REASON
  ) => {
    this.items = [];
    this.status = status;
    this.reason = reason;
    this.isLoading = false;
    this.#lastRelatedRequestKey = '';
  };

  cancelRelatedAssessment = () => {
    if (this.#relatedTimer) {
      window.clearTimeout(this.#relatedTimer);
      this.#relatedTimer = null;
    }

    this.#activeRelatedRequest += 1;
    this.isLoading = false;
  };

  #getActiveRelatedSelectionText = () => {
    return this.scope === 'selection' ? this.selectedText : null;
  };

  #isSelectionInsideEditorRoot = (editorRoot: HTMLDivElement | null) => {
    const selection = window.getSelection();
    if (!selection || !editorRoot) {
      return false;
    }

    const anchorNode =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : (selection.anchorNode?.parentElement ?? null);
    const focusNode =
      selection.focusNode instanceof Element
        ? selection.focusNode
        : (selection.focusNode?.parentElement ?? null);

    return (
      !!anchorNode &&
      !!focusNode &&
      editorRoot.contains(anchorNode) &&
      editorRoot.contains(focusNode)
    );
  };

  updateSelectedRelatedText = (editorRoot: HTMLDivElement | null) => {
    if (!this.#isSelectionInsideEditorRoot(editorRoot)) {
      return;
    }

    const nextSelection = getEditorSelectionText(editorRoot);
    const previousSelection = this.selectedText;
    if (nextSelection === previousSelection) {
      return;
    }

    const hadSelection = !!previousSelection;
    this.selectedText = nextSelection;
    this.scope =
      nextSelection && !hadSelection ? 'selection' : !nextSelection ? 'note' : this.scope;
    this.scheduleRelated({ immediate: true });
  };

  clearSelectedRelatedText = () => {
    this.selectedText = null;
    this.scope = 'note';
  };

  scheduleRelated = ({ immediate = false }: { immediate?: boolean } = {}) => {
    if (this.#relatedTimer) {
      window.clearTimeout(this.#relatedTimer);
      this.#relatedTimer = null;
    }

    if (this.isPanelCollapsed) {
      this.isLoading = false;
      return;
    }

    const activeSelection = this.#getActiveRelatedSelectionText();

    if (this.scope === 'selection' && !activeSelection) {
      this.resetRelatedResults();
      return;
    }

    const delay = activeSelection
      ? getRelatedAssessmentDelay(normalizeRelatedText(activeSelection).length, immediate, true)
      : getRelatedAssessmentDelay(0, immediate, false);
    this.#relatedTimer = window.setTimeout(() => {
      this.#relatedTimer = null;
      void this.runRelatedNotes();
    }, delay);
  };

  runRelatedNotes = async () => {
    if (this.isPanelCollapsed) {
      this.isLoading = false;
      return;
    }

    const selectedText = this.#getActiveRelatedSelectionText();
    if (this.scope === 'selection' && !selectedText) {
      this.resetRelatedResults();
      return;
    }

    const markdown = this.#deps.getCurrentMarkdown();
    const normalizedContent = normalizeRelatedText(selectedText ?? markdown);
    if (normalizedContent === '') {
      this.resetRelatedResults();
      return;
    }

    const requestKey = buildRelatedRequestKey(
      this.#deps.getCurrentPath(),
      this.scope,
      this.#deps.getCurrentTitle(),
      markdown,
      selectedText
    );

    if (requestKey === this.#lastRelatedRequestKey) {
      return;
    }

    const requestId = ++this.#activeRelatedRequest;
    this.isLoading = true;

    try {
      const response = await getRelatedNotes(
        {
          currentPath: this.#deps.getCurrentPath(),
          currentTitle: this.#deps.getCurrentTitle(),
          currentMarkdown: markdown
        },
        selectedText,
        4
      );

      if (requestId !== this.#activeRelatedRequest) {
        return;
      }

      this.items = response.items;
      this.status = response.status;
      this.reason = response.reason;
      this.#lastRelatedRequestKey = requestKey;
    } catch (error) {
      if (requestId !== this.#activeRelatedRequest) {
        return;
      }

      console.error('Failed to load related notes:', error);
      this.items = [];
      this.status = 'unavailable';
      this.reason = 'Related notes are unavailable right now.';
      this.#lastRelatedRequestKey = '';
    } finally {
      if (requestId === this.#activeRelatedRequest) {
        this.isLoading = false;
      }
    }
  };

  handleRelatedScopeChange = (scope: RelatedScope) => {
    if (scope === 'selection' && !this.selectedText) {
      return;
    }

    this.scope = scope;
    this.scheduleRelated({ immediate: true });
  };

  toggleRelatedPanel = (shellEl: HTMLDivElement | null) => {
    this.isPanelCollapsed = !this.isPanelCollapsed;
    this.updateDrawerLayout(shellEl);

    if (this.isPanelCollapsed) {
      this.cancelRelatedAssessment();
      return;
    }

    this.scheduleRelated({ immediate: true });
  };

  collapseRelatedPanel = (shellEl: HTMLDivElement | null) => {
    if (this.isPanelCollapsed) {
      return;
    }

    this.isPanelCollapsed = true;
    this.updateDrawerLayout(shellEl);
    this.cancelRelatedAssessment();
  };

  dispose = () => {
    this.cancelRelatedAssessment();
  };
}

export function createRelatedNotesStore(deps: RelatedStoreDeps) {
  return new RelatedNotesStore(deps);
}

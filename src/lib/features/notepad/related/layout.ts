export const RELATED_SCOPE_SELECTION_MIN_CHARS = 48;
export const EMPTY_RELATED_REASON = 'Write a bit more before looking for related notes.';
export const MIN_SHELL_WIDTH_FOR_SIDE_RELATED = 760;

export type RelatedScope = 'note' | 'selection';
export type RelatedPanelPlacement = 'side' | 'bottom';

interface RelatedDrawerLayout {
  placement: RelatedPanelPlacement;
  reservedWidth: number;
}

function hashRelatedText(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

export function normalizeRelatedText(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

export function getExpandedRelatedDrawerWidth(viewportWidth = window.innerWidth) {
  const preferred = viewportWidth * 0.24;
  return Math.round(Math.max(18 * 16, Math.min(preferred, 22 * 16)));
}

export function getCollapsedRelatedDrawerWidth() {
  return 44;
}

export function getLayoutRelatedDrawerWidth(
  isRelatedPanelCollapsed: boolean,
  viewportWidth?: number
) {
  if (viewportWidth === undefined) {
    return isRelatedPanelCollapsed ? getCollapsedRelatedDrawerWidth() : 320;
  }

  return isRelatedPanelCollapsed
    ? getCollapsedRelatedDrawerWidth()
    : getExpandedRelatedDrawerWidth(viewportWidth);
}

export function getVisualRelatedDrawerWidth(viewportWidth?: number) {
  if (viewportWidth === undefined) {
    return 320;
  }

  return getExpandedRelatedDrawerWidth(viewportWidth);
}

export function findHorizontalClipBoundary(element: HTMLElement, viewportWidth = window.innerWidth) {
  let current: HTMLElement | null = element.parentElement;
  let boundary = viewportWidth;

  while (current) {
    const styles = window.getComputedStyle(current);
    if (
      styles.overflowX !== 'visible' ||
      styles.overflow === 'hidden' ||
      styles.overflow === 'clip'
    ) {
      boundary = Math.min(boundary, current.getBoundingClientRect().right);
    }
    current = current.parentElement;
  }

  return boundary;
}

export function computeRelatedDrawerLayout(
  shellEl: HTMLDivElement,
  isRelatedPanelCollapsed: boolean,
  viewportWidth = window.innerWidth
): RelatedDrawerLayout {
  const shellRect = shellEl.getBoundingClientRect();
  const drawerGap = 16;
  const rightBoundary = findHorizontalClipBoundary(shellEl, viewportWidth) - 8;
  const availableRightSpace = Math.max(0, rightBoundary - shellRect.right);
  const openSideOverflow = Math.max(
    0,
    getExpandedRelatedDrawerWidth(viewportWidth) + drawerGap - availableRightSpace
  );
  const projectedSideWidth = shellRect.width - openSideOverflow;

  if (projectedSideWidth < MIN_SHELL_WIDTH_FOR_SIDE_RELATED) {
    return {
      placement: 'bottom',
      reservedWidth: 0
    };
  }

  return {
    placement: 'side',
    reservedWidth: Math.max(
      0,
      getLayoutRelatedDrawerWidth(isRelatedPanelCollapsed, viewportWidth) +
        drawerGap -
        availableRightSpace
    )
  };
}

export function getRelatedGroupStyle(
  relatedPanelPlacement: RelatedPanelPlacement,
  relatedDrawerReservedWidth: number
) {
  const reserved = relatedPanelPlacement === 'bottom' ? 0 : relatedDrawerReservedWidth;
  return `--related-reserved-width: ${reserved}px;`;
}

export function getCardStyle(
  relatedPanelPlacement: RelatedPanelPlacement,
  relatedDrawerReservedWidth: number
) {
  if (relatedPanelPlacement === 'bottom') {
    return 'width: 100%;';
  }

  return 'width: calc(100% - var(--related-reserved-width));';
}

export function getRelatedDrawerStyle(
  relatedDrawerReservedWidth: number,
  viewportWidth?: number
) {
  return `left: calc(100% + var(--related-drawer-gap) - var(--related-reserved-width)); width: ${getVisualRelatedDrawerWidth(viewportWidth)}px;`;
}

export function getBottomSheetStyle() {
  return 'top: 1rem; right: 1rem; bottom: var(--related-bottom-offset); width: min(calc(100% - 1rem), 32rem);';
}

export function buildRelatedRequestKey(
  currentNotePath: string | null,
  relatedScope: RelatedScope,
  title: string,
  markdown: string,
  selectedText: string | null
) {
  return [
    currentNotePath ?? '',
    relatedScope,
    hashRelatedText(title),
    hashRelatedText(markdown),
    hashRelatedText(selectedText ?? '')
  ].join(':');
}

export function getEditorDomSelection(editorRoot: HTMLDivElement | null) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return null;
  }

  const anchorNode =
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode?.parentElement ?? null;
  const focusNode =
    selection.focusNode instanceof Element
      ? selection.focusNode
      : selection.focusNode?.parentElement ?? null;
  if (!anchorNode || !focusNode || !editorRoot) {
    return null;
  }

  if (!editorRoot.contains(anchorNode) || !editorRoot.contains(focusNode)) {
    return null;
  }

  return selection;
}

export function getEditorSelectionText(
  editorRoot: HTMLDivElement | null,
  minChars = RELATED_SCOPE_SELECTION_MIN_CHARS
) {
  const selection = getEditorDomSelection(editorRoot);
  if (!selection) {
    return null;
  }

  const text = normalizeRelatedText(selection.toString());
  if (text.length < minChars) {
    return null;
  }

  return text;
}

export function getRelatedAssessmentDelay(
  normalizedContentLength: number,
  immediate: boolean,
  hasActiveSelection: boolean
) {
  if (immediate) {
    return hasActiveSelection ? 180 : 220;
  }

  return Math.max(900, Math.min(3600, 900 + Math.round(normalizedContentLength / 320) * 180));
}

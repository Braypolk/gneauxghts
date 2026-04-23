import type { PendingTaskTarget } from '$lib/taskNavigation';
import type { SearchItem } from '$lib/types/semantic';
import { findBestEditorTarget, focusEditorTarget, waitForEditorPaint } from '$lib/features/notepad/navigation/navigation';
import { isSemanticOnlyResult } from '$lib/features/notepad/search/search';
import type { RecentTaskItem, ResolvedNoteLink } from '$lib/features/notepad/model/types';

export interface NavigationContext {
  editorRoot: HTMLDivElement | null;
  titleShell: HTMLDivElement | null;
  currentNoteId: string | null;
  currentNotePath: string | null;
  focusTitleAtEnd: () => void;
}

export interface OpenContext {
  currentNoteId: string | null;
  currentNotePath: string | null;
  stopPendingAutosave: () => void;
  clearSearch: () => void;
  openNotePath: (
    noteId: string | null,
    notePath: string | null,
    options?: { currentNoteAlreadySaved?: boolean; focusEditorAfterOpen?: boolean }
  ) => Promise<void>;
}

async function ensureNoteContext(
  { currentNoteId, currentNotePath, stopPendingAutosave, openNotePath }: OpenContext,
  nextNoteId: string | null,
  nextNotePath: string | null,
  options: { focusEditorAfterOpen?: boolean } = {}
) {
  const shouldOpenDifferentNote =
    (!!nextNoteId && nextNoteId !== currentNoteId) ||
    (!!nextNotePath && nextNotePath !== currentNotePath);

  if (!shouldOpenDifferentNote || (!nextNoteId && !nextNotePath)) {
    return false;
  }

  stopPendingAutosave();
  await openNotePath(nextNoteId, nextNotePath, options);
  return true;
}

export async function navigateToSectionTarget(
  { editorRoot, titleShell, focusTitleAtEnd }: NavigationContext,
  sectionLabel: string,
  matchText: string,
  shouldFocus = true
) {
  await waitForEditorPaint();

  if (sectionLabel === 'Title') {
    titleShell?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (shouldFocus) {
      focusTitleAtEnd();
    }
    return;
  }

  const paragraphMatch = sectionLabel.match(/^Paragraph (\d+)$/);
  const paragraphIndex = paragraphMatch ? Number(paragraphMatch[1]) - 1 : undefined;
  const targetBlock = findBestEditorTarget(editorRoot, matchText || sectionLabel, paragraphIndex);

  if (!targetBlock) {
    return;
  }

  if (!shouldFocus) {
    targetBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  focusEditorTarget(editorRoot, targetBlock);
}

export async function navigateToPendingTaskTarget(
  { currentNoteId, currentNotePath, editorRoot }: NavigationContext,
  target: PendingTaskTarget
) {
  if (
    (currentNoteId && currentNoteId !== target.noteId) ||
    (!currentNoteId && (!currentNotePath || currentNotePath !== target.notePath))
  ) {
    return;
  }

  await waitForEditorPaint();

  const targetBlock = findBestEditorTarget(editorRoot, target.text);
  if (targetBlock) {
    focusEditorTarget(editorRoot, targetBlock);
  }
}

export async function openSearchResult(
  openContext: OpenContext,
  navigationContext: NavigationContext,
  result: SearchItem
) {
  const shouldFocus = !isSemanticOnlyResult(result);
  await ensureNoteContext(openContext, result.noteId ?? null, result.notePath ?? null, {
    focusEditorAfterOpen: shouldFocus
  });
  openContext.clearSearch();

  await navigateToSectionTarget(
    navigationContext,
    result.sectionLabel,
    result.matchText,
    shouldFocus
  );
}

export async function openRecentTask(
  openContext: OpenContext,
  navigationContext: NavigationContext,
  task: RecentTaskItem
) {
  await ensureNoteContext(openContext, task.noteId, task.notePath, {
    focusEditorAfterOpen: true
  });
  openContext.clearSearch();

  await navigateToPendingTaskTarget(navigationContext, {
    noteId: task.noteId,
    notePath: task.notePath,
    text: task.text,
    lineNumber: task.lineNumber,
    sectionLabel: null
  });
}

export async function openResolvedNoteLink(
  openContext: Omit<OpenContext, 'clearSearch'>,
  navigationContext: NavigationContext,
  target: ResolvedNoteLink
) {
  await ensureNoteContext(
    {
      ...openContext,
      clearSearch: () => {}
    },
    target.noteId,
    target.notePath,
    { focusEditorAfterOpen: true }
  );

  await navigateToSectionTarget(
    navigationContext,
    target.sectionLabel,
    target.matchText
  );
}

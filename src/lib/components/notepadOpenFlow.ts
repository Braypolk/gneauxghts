import type { PendingTaskTarget } from '$lib/taskNavigation';
import type { SearchItem } from '$lib/types/semantic';
import { findBestEditorTarget, focusEditorTarget, waitForEditorPaint } from './notepadNavigation';
import { isSemanticOnlyResult } from './notepadSearch';
import type { RecentTaskItem, ResolvedNoteLink } from './notepadTypes';

export interface NotepadNavigationContext {
  editorRoot: HTMLDivElement | null;
  titleShell: HTMLDivElement | null;
  currentNotePath: string | null;
  focusTitleAtEnd: () => void;
}

export interface NotepadOpenContext {
  currentNotePath: string | null;
  stopPendingAutosave: () => void;
  enqueueAutosave: () => Promise<void>;
  clearSearch: () => void;
  openNotePath: (
    notePath: string,
    options?: { currentNoteAlreadySaved?: boolean }
  ) => Promise<void>;
}

async function ensureNoteContext(
  { currentNotePath, stopPendingAutosave, enqueueAutosave, openNotePath }: NotepadOpenContext,
  nextNotePath: string | null
) {
  const shouldOpenDifferentNote = !!nextNotePath && nextNotePath !== currentNotePath;

  stopPendingAutosave();

  if (!shouldOpenDifferentNote || !nextNotePath) {
    return false;
  }

  await enqueueAutosave();
  await openNotePath(nextNotePath, { currentNoteAlreadySaved: true });
  return true;
}

export async function navigateToSectionTarget(
  { editorRoot, titleShell, focusTitleAtEnd }: NotepadNavigationContext,
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
  { currentNotePath, editorRoot }: NotepadNavigationContext,
  target: PendingTaskTarget
) {
  if (!currentNotePath || currentNotePath !== target.notePath) {
    return;
  }

  await waitForEditorPaint();

  const targetBlock = findBestEditorTarget(editorRoot, target.text);
  if (targetBlock) {
    focusEditorTarget(editorRoot, targetBlock);
  }
}

export async function openSearchResult(
  openContext: NotepadOpenContext,
  navigationContext: NotepadNavigationContext,
  result: SearchItem
) {
  await ensureNoteContext(openContext, result.notePath ?? null);
  openContext.clearSearch();

  await navigateToSectionTarget(
    navigationContext,
    result.sectionLabel,
    result.matchText,
    !isSemanticOnlyResult(result)
  );
}

export async function openRecentTask(
  openContext: NotepadOpenContext,
  navigationContext: NotepadNavigationContext,
  task: RecentTaskItem
) {
  await ensureNoteContext(openContext, task.notePath);
  openContext.clearSearch();

  await navigateToPendingTaskTarget(navigationContext, {
    notePath: task.notePath,
    text: task.text,
    lineNumber: task.lineNumber,
    sectionLabel: null
  });
}

export async function openResolvedNoteLink(
  openContext: Omit<NotepadOpenContext, 'clearSearch'>,
  navigationContext: NotepadNavigationContext,
  target: ResolvedNoteLink
) {
  await ensureNoteContext(
    {
      ...openContext,
      clearSearch: () => {}
    },
    target.notePath
  );

  await navigateToSectionTarget(
    navigationContext,
    target.sectionLabel,
    target.matchText
  );
}

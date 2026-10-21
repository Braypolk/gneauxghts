import { captureFocusIntent } from './focusIntent';
import type { PendingTaskTarget } from '$lib/taskNavigation';
import { navigationScrollBehavior } from '$lib/ui/motion';
import type { SearchItem } from '$lib/types/semantic';
import {
  revealEditorTextTarget,
  revealEditorCitationTarget,
  waitForEditorPaint
} from '$lib/features/notepad/navigation/navigation';
import { isSemanticOnlyResult } from '$lib/features/notepad/search/search';
import type { RecentTaskItem, ResolvedNoteLink } from '$lib/features/notepad/model/types';

export interface NavigationContext {
  signal?: AbortSignal;
  editorRoot: HTMLDivElement | null;
  titleShell: HTMLDivElement | null;
  currentNoteId: string | null;
  currentNotePath: string | null;
  focusTitleAtEnd: () => void;
  isCurrent?: () => boolean;
}

export type NavigationContextSource = () => NavigationContext;

// Keep the same interaction admission through both the note load and later paint.
async function withNavigationFocus<T>(
  getContext: NavigationContextSource,
  action: (getCurrentContext: NavigationContextSource) => Promise<T>
) {
  const intent = captureFocusIntent(getContext().signal);
  try {
    return await action(() => {
      const context = getContext();
      return { ...context, isCurrent: () => intent.isCurrent() && (context.isCurrent?.() ?? true) };
    });
  } finally {
    intent.dispose();
  }
}

/** Uses ordinary note departure/loading; passage selection rechecks the live editor. */
export async function openNoteCitation(
  openContext: OpenContext,
  getNavigationContext: NavigationContextSource,
  target: { noteId: string; path: string; location?: { quote: string } }
): Promise<boolean> {
  return withNavigationFocus(getNavigationContext, async getCurrentContext => {
    await openContext.openNotePath(target.noteId, target.path, { focusEditorAfterOpen: true });
    if (!matchesTarget(getCurrentContext(), target.noteId, target.path)) return false;
    if (!target.location) return true;
    await waitForEditorPaint();
    const context = getCurrentContext();
    return matchesTarget(context, target.noteId, target.path)
      && revealEditorCitationTarget(context.editorRoot, target.location.quote);
  });
}

function matchesTarget(ctx: NavigationContext, noteId: string | null, path: string | null) {
  return (ctx.isCurrent?.() ?? true) && (noteId ? ctx.currentNoteId === noteId : !!path && ctx.currentNotePath === path);
}

export interface OpenContext {
  currentNoteId: string | null;
  currentNotePath: string | null;
  isEditorVisible?: boolean;
  stopPendingAutosave: () => void;
  clearSearch: () => void;
  openNotePath: (
    noteId: string | null,
    notePath: string | null,
    options?: { currentNoteAlreadySaved?: boolean; focusEditorAfterOpen?: boolean }
  ) => Promise<void>;
}

async function ensureNoteContext(
  { currentNoteId, currentNotePath, isEditorVisible, stopPendingAutosave, openNotePath }: OpenContext,
  nextNoteId: string | null,
  nextNotePath: string | null,
  options: { focusEditorAfterOpen?: boolean } = {}
) {
  const shouldOpen =
    isEditorVisible === false ||
    (!!nextNoteId && nextNoteId !== currentNoteId) ||
    (!!nextNotePath && nextNotePath !== currentNotePath);

  if (!shouldOpen || (!nextNoteId && !nextNotePath)) {
    return false;
  }

  stopPendingAutosave();
  await openNotePath(nextNoteId, nextNotePath, options);
  return true;
}

export async function navigateToSectionTarget(
  ctx: NavigationContext,
  sectionLabel: string,
  matchText: string,
  shouldFocus = true
) {
  await waitForEditorPaint();
  if (ctx.isCurrent && !ctx.isCurrent()) return;
  const { editorRoot, titleShell, focusTitleAtEnd } = ctx;

  if (sectionLabel === 'Title') {
    titleShell?.scrollIntoView({ behavior: navigationScrollBehavior(), block: 'center' });
    if (shouldFocus) {
      focusTitleAtEnd();
    }
    return;
  }

  revealEditorTextTarget(editorRoot, matchText || sectionLabel, { focus: shouldFocus });
}

export async function navigateToPendingTaskTarget(
  ctx: NavigationContext,
  target: PendingTaskTarget
) {
  const { editorRoot } = ctx;
  if (!matchesTarget(ctx, target.noteId, target.notePath)) return;
  await waitForEditorPaint();
  if (!matchesTarget(ctx, target.noteId, target.notePath)) return;

  // Indexed body coordinates are hints: verify the task text before focusing.
  // A shifted or deleted task must never target an unrelated/clamped line.
  revealEditorTextTarget(editorRoot, target.text, { preferredLine: target.editorLineNumber });
}

export async function openSearchResult(
  openContext: OpenContext,
  getNavigationContext: NavigationContextSource,
  result: SearchItem
) {
  return withNavigationFocus(getNavigationContext, async getCurrentContext => {
    const shouldFocus = !isSemanticOnlyResult(result);
    await ensureNoteContext(openContext, result.noteId ?? null, result.notePath ?? null, {
      focusEditorAfterOpen: shouldFocus
    });
    const navigationContext = getCurrentContext();
    if (!matchesTarget(navigationContext, result.noteId, result.notePath)) return;
    openContext.clearSearch();

    // A title-only result identifies the note, not a body destination. Keep the
    // note's remembered cursor/scroll state instead of manufacturing an editor
    // anchor from the title match.
    if (result.sectionLabel === 'Title') {
      return;
    }

    await navigateToSectionTarget(
      navigationContext,
      result.sectionLabel,
      result.matchText,
      shouldFocus
    );
  });
}


export async function openRecentTask(
  openContext: OpenContext,
  getNavigationContext: NavigationContextSource,
  task: RecentTaskItem
) {
  return withNavigationFocus(getNavigationContext, async getCurrentContext => {
    await ensureNoteContext(openContext, task.noteId, task.notePath, {
      focusEditorAfterOpen: true
    });
    const navigationContext = getCurrentContext();
    if (!matchesTarget(navigationContext, task.noteId, task.notePath)) return;
    openContext.clearSearch();

    await navigateToPendingTaskTarget(navigationContext, {
      noteId: task.noteId,
      notePath: task.notePath,
      text: task.text,
      lineNumber: task.lineNumber,
      sectionLabel: null
    });
  });
}


export async function openResolvedNoteLink(
  openContext: Omit<OpenContext, 'clearSearch'>,
  getNavigationContext: NavigationContextSource,
  target: ResolvedNoteLink
) {
  return withNavigationFocus(getNavigationContext, async getCurrentContext => {
    await ensureNoteContext(
      {
        ...openContext,
        clearSearch: () => {}
      },
      target.noteId,
      target.notePath,
      { focusEditorAfterOpen: true }
    );

    const navigationContext = getCurrentContext();
    if (!matchesTarget(navigationContext, target.noteId, target.notePath)) return;
    await navigateToSectionTarget(
      navigationContext,
      target.sectionLabel,
      target.matchText
    );
  });
}

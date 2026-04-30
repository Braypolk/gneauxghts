import { get, writable } from 'svelte/store';
import {
  buildApprovedChanges,
  buildReviewChanges,
  getReviewChangePath,
  type ReviewChange
} from '$lib/features/inbox/reviewChanges';
import type { InboxItemDetail } from '$lib/types/ai';

export interface ProposalSession {
  itemId: number;
  kind: InboxItemDetail['kind'];
  status: InboxItemDetail['status'];
  title: string;
  summary: string;
  sourcePath: string;
  sourceTitle: string;
  sourceMarkdown: string;
  reviewChanges: ReviewChange[];
  notePaths: string[];
  focusedPath: string | null;
  createdAtMillis: number;
  updatedAtMillis: number;
}

export const activeProposalSession = writable<ProposalSession | null>(null);

export function syncProposalSessionFromInboxItem(
  item: InboxItemDetail | null,
  {
    focusedPath = null,
    preserveSelections = true
  }: {
    focusedPath?: string | null;
    preserveSelections?: boolean;
  } = {}
) {
  if (!item || item.status !== 'pendingApproval') {
    activeProposalSession.set(null);
    return;
  }

  const current = get(activeProposalSession);
  const reviewChanges =
    preserveSelections && current?.itemId === item.id
      ? current.reviewChanges
      : buildReviewChanges(item.changePreviews);
  const notePaths = uniqueNotePaths(reviewChanges);
  const nextFocusedPath = resolveFocusedPath(
    notePaths,
    focusedPath ?? (current?.itemId === item.id ? current.focusedPath : null),
    item.sourcePath
  );

  activeProposalSession.set({
    itemId: item.id,
    kind: item.kind,
    status: item.status,
    title: item.title,
    summary: item.summary,
    sourcePath: item.sourcePath,
    sourceTitle: item.sourceTitle,
    sourceMarkdown: item.sourceMarkdown,
    reviewChanges,
    notePaths,
    focusedPath: nextFocusedPath,
    createdAtMillis: item.createdAtMillis,
    updatedAtMillis: item.updatedAtMillis
  });
}

export function clearProposalSession() {
  activeProposalSession.set(null);
}

export function focusProposalPath(path: string | null) {
  activeProposalSession.update((session) => {
    if (!session) {
      return session;
    }
    return {
      ...session,
      focusedPath: resolveFocusedPath(session.notePaths, path, session.sourcePath)
    };
  });
}

export function toggleProposalChange(changeId: string, selected: boolean) {
  activeProposalSession.update((session) => {
    if (!session) {
      return session;
    }

    return {
      ...session,
      reviewChanges: session.reviewChanges.map((reviewChange) => {
        if (reviewChange.id !== changeId) {
          return reviewChange;
        }
        return { ...reviewChange, selected };
      })
    };
  });
}

export function getApprovedChangesForSession(session: ProposalSession | null) {
  return buildApprovedChanges(session?.reviewChanges ?? []);
}

export function getSelectedApprovedChangeCount(session: ProposalSession | null) {
  return getApprovedChangesForSession(session).length;
}

export function getProposalChangesForPath(session: ProposalSession | null, path: string | null) {
  if (!session || !path) {
    return [];
  }

  return session.reviewChanges.filter((reviewChange) => getReviewChangePath(reviewChange) === path);
}

function uniqueNotePaths(reviewChanges: ReviewChange[]) {
  const unique = new Set<string>();
  for (const reviewChange of reviewChanges) {
    const path = getReviewChangePath(reviewChange);
    if (path) {
      unique.add(path);
    }
  }
  return [...unique];
}

function resolveFocusedPath(
  notePaths: string[],
  preferredPath: string | null,
  fallbackPath: string | null
) {
  if (preferredPath && notePaths.includes(preferredPath)) {
    return preferredPath;
  }
  if (fallbackPath && notePaths.includes(fallbackPath)) {
    return fallbackPath;
  }
  return notePaths[0] ?? null;
}

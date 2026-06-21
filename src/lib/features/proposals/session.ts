import { get, writable } from 'svelte/store';
import {
  buildApprovedChanges,
  buildReviewChanges,
  getReviewChangePath,
  reviewUpdateOpCounts,
  type ReviewChange,
  type ReviewUpdateChange
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

/**
 * Accept or reject a single block op within an `updateNote` review change. The
 * file-level `selected` flag is untouched — op-level selection refines which
 * blocks of an accepted note are applied. Accepting an op also re-selects the
 * note (rejecting every op leaves the note selected but applies no body change).
 */
export function toggleProposalOp(changeId: string, opId: string, accepted: boolean) {
  activeProposalSession.update((session) => {
    if (!session) {
      return session;
    }

    return {
      ...session,
      reviewChanges: session.reviewChanges.map((reviewChange) => {
        if (reviewChange.id !== changeId || reviewChange.kind !== 'updateNote') {
          return reviewChange;
        }
        const without = reviewChange.acceptedOpIds.filter((id) => id !== opId);
        const acceptedOpIds = accepted ? [...without, opId] : without;
        return { ...reviewChange, acceptedOpIds, selected: accepted ? true : reviewChange.selected };
      })
    };
  });
}

/** Accept or reject every op of an `updateNote` change at once. */
export function setAllProposalOps(changeId: string, accepted: boolean) {
  activeProposalSession.update((session) => {
    if (!session) {
      return session;
    }

    return {
      ...session,
      reviewChanges: session.reviewChanges.map((reviewChange) => {
        if (reviewChange.id !== changeId || reviewChange.kind !== 'updateNote') {
          return reviewChange;
        }
        return {
          ...reviewChange,
          acceptedOpIds: accepted ? reviewChange.ops.map((op) => op.opId) : []
        };
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

export interface PendingProposalNotice {
  /** The inbox item id whose proposal touches this note. */
  itemId: number;
  /** Number of review changes (across kinds) that touch this note path. */
  changeCount: number;
}

/**
 * Read-only summary of whether the active pending-approval proposal touches a
 * given note path. Used by the editor to show a non-invasive "review pending"
 * indicator that links back to the inbox. Returns `null` when no active session
 * touches the path. The editor stays read-only with respect to proposals — this
 * is a pointer to the inbox, not an inline review surface.
 */
export function getPendingProposalNotice(
  session: ProposalSession | null,
  path: string | null
): PendingProposalNotice | null {
  if (!session || !path) {
    return null;
  }
  const changeCount = getProposalChangesForPath(session, path).length;
  if (changeCount === 0) {
    return null;
  }
  return { itemId: session.itemId, changeCount };
}

export interface ReviewOverlayModel {
  /** The inbox item id whose proposal touches the open note. */
  itemId: number;
  /** The review change id, for routing the user to the inbox decision UI. */
  changeId: string;
  /** Current note body (the "old" side of the read-only diff). */
  currentMarkdown: string;
  /** Proposed note body (the "new" side of the read-only diff). */
  proposedMarkdown: string;
  /** Whether the proposal also renames the note. */
  titleChanged: boolean;
  currentTitle: string;
  proposedTitle: string;
  /** Accepted / total block-op counts, mirroring the inbox op cards. */
  opCounts: { accepted: number; total: number };
}

/**
 * Resolve the open note's pending `updateNote` proposal into a read-only overlay
 * model. The in-editor overlay renders the SAME current→proposed diff as the
 * inbox (via MarkdownDiffView) but makes no decisions itself — accept/reject
 * stays in the inbox to keep the editor strictly read-only in v1. Returns `null`
 * when no pending update touches the path (e.g. a create/delete-only proposal,
 * or no active session).
 */
export function getReviewOverlayModel(
  session: ProposalSession | null,
  path: string | null
): ReviewOverlayModel | null {
  if (!session || !path) {
    return null;
  }
  const updateChange = getProposalChangesForPath(session, path).find(
    (reviewChange): reviewChange is ReviewUpdateChange => reviewChange.kind === 'updateNote'
  );
  if (!updateChange) {
    return null;
  }
  return {
    itemId: session.itemId,
    changeId: updateChange.id,
    currentMarkdown: updateChange.currentMarkdown,
    proposedMarkdown: updateChange.proposedMarkdown,
    titleChanged: updateChange.titleChanged,
    currentTitle: updateChange.currentTitle,
    proposedTitle: updateChange.proposedTitle,
    opCounts: reviewUpdateOpCounts(updateChange)
  };
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

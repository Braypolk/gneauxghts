import {
  noteChangePath,
  noteChangeProposedMarkdown,
  noteChangeTitle,
  type NoteChange
} from '$lib/types/proposals';
import {
  buildCreateDiff,
  buildDeleteDiff,
  buildLineDiff,
  type NoteDiffModel
} from './diffModel';
import type {
  PendingProposalChange,
  ProposalChangeStatus,
  ProposalReviewSessionSnapshot
} from './types';

function createId(change: NoteChange, index: number): string {
  if (change.kind === 'updateNote') return `${index}:update:${change.path}`;
  if (change.kind === 'createNote') {
    return `${index}:create:${change.suggestedTitle || 'untitled'}`;
  }
  return `${index}:delete:${change.path}`;
}

function buildDiffForChange(change: NoteChange, baseMarkdown: string): NoteDiffModel {
  if (change.kind === 'createNote') return buildCreateDiff(change.markdown);
  if (change.kind === 'deleteNote') return buildDeleteDiff(baseMarkdown);
  return buildLineDiff(baseMarkdown, change.newMarkdown);
}

export function createPendingChange(
  change: NoteChange,
  baseMarkdown: string,
  index: number
): PendingProposalChange {
  return {
    id: createId(change, index),
    change,
    status: 'pending',
    baseMarkdown,
    diff: buildDiffForChange(change, baseMarkdown),
    title: noteChangeTitle(change),
    path: noteChangePath(change),
    error: null
  };
}

function emptySnapshot(): ProposalReviewSessionSnapshot {
  return {
    source: '',
    changes: [],
    activeChangeId: null,
    isApplying: false,
    isConflicted: false,
    error: null,
    reviewHunks: null
  };
}

/**
 * Shared proposal review session. Chat list and notepad inline review both bind here.
 */
export function createProposalReviewSession() {
  let snapshot = $state<ProposalReviewSessionSnapshot>(emptySnapshot());

  function pendingChanges(): PendingProposalChange[] {
    return snapshot.changes.filter((change) => change.status === 'pending');
  }

  function getChange(changeId: string): PendingProposalChange | undefined {
    return snapshot.changes.find((change) => change.id === changeId);
  }

  function setStatus(changeId: string, status: ProposalChangeStatus, error: string | null = null) {
    snapshot = {
      ...snapshot,
      changes: snapshot.changes.map((change) =>
        change.id === changeId ? { ...change, status, error } : change
      ),
      error: error ?? snapshot.error
    };
  }

  function load(
    changes: NoteChange[],
    baseMarkdownByPath: Record<string, string>,
    source = 'fixture'
  ) {
    const pending = changes.map((change, index) => {
      const path = noteChangePath(change);
      const baseMarkdown =
        change.kind === 'createNote'
          ? ''
          : (path ? baseMarkdownByPath[path] : undefined) ??
            noteChangeProposedMarkdown(change) ??
            '';
      return createPendingChange(change, baseMarkdown, index);
    });
    snapshot = {
      source,
      changes: pending,
      activeChangeId: pending.find((change) => change.status === 'pending')?.id ?? null,
      isApplying: false,
      isConflicted: false,
      error: null,
      reviewHunks: null
    };
  }

  function clear() {
    snapshot = emptySnapshot();
  }

  function setActiveChangeId(changeId: string | null) {
    snapshot = { ...snapshot, activeChangeId: changeId };
  }

  function markUndone(changeId: string) {
    setStatus(changeId, 'undone');
    if (snapshot.activeChangeId === changeId) {
      const next = pendingChanges()[0];
      snapshot = { ...snapshot, activeChangeId: next?.id ?? null };
    }
  }

  function markKept(changeId: string) {
    setStatus(changeId, 'kept');
    if (snapshot.activeChangeId === changeId) {
      const next = pendingChanges()[0];
      snapshot = { ...snapshot, activeChangeId: next?.id ?? null };
    }
  }

  function markAllUndone() {
    snapshot = {
      ...snapshot,
      changes: snapshot.changes.map((change) =>
        change.status === 'pending' ? { ...change, status: 'undone', error: null } : change
      ),
      activeChangeId: null,
      error: null
    };
  }

  function setApplying(isApplying: boolean) {
    snapshot = { ...snapshot, isApplying };
  }

  function setError(error: string | null) {
    snapshot = { ...snapshot, error };
  }

  function setConflicted(isConflicted: boolean) {
    snapshot = { ...snapshot, isConflicted };
  }

  function setReviewHunks(total: number, unresolved: number) {
    snapshot = { ...snapshot, reviewHunks: { total, unresolved } };
  }

  function setChangeError(changeId: string, error: string) {
    setStatus(changeId, 'pending', error);
    snapshot = { ...snapshot, error };
  }

  function findPendingForPath(path: string | null): PendingProposalChange | null {
    if (!path) return null;
    return (
      pendingChanges().find((change) => change.path === path) ??
      null
    );
  }

  function nextPending(fromId: string | null = snapshot.activeChangeId): PendingProposalChange | null {
    const pending = pendingChanges();
    if (pending.length === 0) return null;
    if (!fromId) return pending[0] ?? null;
    const index = pending.findIndex((change) => change.id === fromId);
    if (index < 0) return pending[0] ?? null;
    return pending[(index + 1) % pending.length] ?? pending[0] ?? null;
  }

  return {
    get snapshot() {
      return snapshot;
    },
    get pendingCount() {
      return pendingChanges().length;
    },
    pendingChanges,
    getChange,
    load,
    clear,
    setActiveChangeId,
    markUndone,
    markKept,
    markAllUndone,
    setApplying,
    setError,
    setConflicted,
    setReviewHunks,
    setChangeError,
    findPendingForPath,
    nextPending
  };
}

export type ProposalReviewSession = ReturnType<typeof createProposalReviewSession>;

/** App-wide session singleton used by chat + notepad. */
export const proposalReviewSession = createProposalReviewSession();

import type { SessionSnapshot } from '$lib/features/notepad/session/session';
import {
  createDocumentOperationState,
  isDocumentOperationTokenCurrent,
  transitionDocumentOperation,
  type DocumentOperationEvent,
  type DocumentOperationKind,
  type DocumentOperationState
} from './documentOperationMachine';
import {
  createDocumentExternalSyncState,
  isDocumentExternalConflictCurrent,
  transitionDocumentExternalSync,
  type DocumentExternalSyncEvent,
  type DocumentExternalSyncState
} from './documentExternalSyncMachine';

export type {
  DocumentOperationKind,
  DocumentOperationState
} from './documentOperationMachine';
export type {
  DocumentExternalSyncEvent,
  DocumentExternalSyncState
} from './documentExternalSyncMachine';

export type NoteKey = `path:${string}` | `draft:${string}`;

export interface DocumentWorkingContent {
  title: string;
  markdown: string;
}

export type DocumentIdentity =
  | { kind: 'draft' }
  | {
      kind: 'persisted';
      noteId: string | null;
      path: string;
    };

export interface DocumentSavedBaseline {
  content: DocumentWorkingContent;
  identity: DocumentIdentity;
}

export type ExternalRefreshSource =
  | 'watcher'
  | 'windowFocus'
  | 'visibility'
  | 'taskMutation';

export interface ExternalDocumentSnapshot {
  content: DocumentWorkingContent;
  identity: DocumentIdentity;
  savedBaseline: DocumentSavedBaseline | null;
}

export type ExternalDocumentChange =
  | {
      kind: 'snapshot';
      source: ExternalRefreshSource;
      document: ExternalDocumentSnapshot;
    }
  | {
      kind: 'deletion';
      source: ExternalRefreshSource;
      path: string;
    };

export interface NoteDraftState {
  key: NoteKey;
  working: DocumentWorkingContent;
  identity: DocumentIdentity;
  savedBaseline: DocumentSavedBaseline | null;
  operation: DocumentOperationState;
  externalSync: DocumentExternalSyncState;
}

function identityFromBoundary(
  noteId: string | null,
  path: string | null
): DocumentIdentity {
  return path
    ? { kind: 'persisted', noteId, path }
    : { kind: 'draft' };
}

function identityEquals(
  left: DocumentIdentity,
  right: DocumentIdentity
) {
  return (
    left.kind === right.kind &&
    (left.kind === 'draft' ||
      (right.kind === 'persisted' &&
        left.noteId === right.noteId &&
        left.path === right.path))
  );
}

function contentEquals(
  left: DocumentWorkingContent,
  right: DocumentWorkingContent
) {
  return (
    left.title === right.title &&
    left.markdown === right.markdown
  );
}

export function externalDocumentSnapshotFromSession(
  snapshot: SessionSnapshot
): ExternalDocumentSnapshot {
  const baselineIdentity = identityFromBoundary(
    snapshot.lastSavedNoteId,
    snapshot.lastSavedPath
  );
  const hasSavedBaseline =
    snapshot.lastSavedPath !== null ||
    snapshot.lastSavedNoteId !== null ||
    snapshot.lastSavedTitle !== '' ||
    snapshot.lastSavedMarkdown !== '';
  return {
    content: {
      title: snapshot.title,
      markdown: snapshot.bodyMarkdown
    },
    identity: identityFromBoundary(
      snapshot.currentNoteId,
      snapshot.currentNotePath
    ),
    savedBaseline: hasSavedBaseline
      ? {
          content: {
            title: snapshot.lastSavedTitle,
            markdown: snapshot.lastSavedMarkdown
          },
          identity: baselineIdentity
        }
      : null
  };
}

export function createDocumentState(
  snapshot: SessionSnapshot,
  key: NoteKey
): NoteDraftState {
  const external = externalDocumentSnapshotFromSession(
    snapshot
  );
  const document: NoteDraftState = {
    key,
    working: { ...external.content },
    identity: external.identity,
    savedBaseline: external.savedBaseline,
    operation: createDocumentOperationState(),
    externalSync: createDocumentExternalSyncState()
  };
  return document;
}

export function getDocumentTitle(document: NoteDraftState) {
  return document.working.title;
}

export function getDocumentMarkdown(document: NoteDraftState) {
  return document.working.markdown;
}

export function getDocumentNoteId(
  document: NoteDraftState
): string | null {
  return document.identity.kind === 'persisted'
    ? document.identity.noteId
    : null;
}

export function getDocumentPath(
  document: NoteDraftState
): string | null {
  return document.identity.kind === 'persisted'
    ? document.identity.path
    : null;
}

export function documentToSessionSnapshot(
  document: NoteDraftState
): SessionSnapshot {
  const baseline = document.savedBaseline;
  return {
    title: document.working.title,
    bodyMarkdown: document.working.markdown,
    currentNoteId: getDocumentNoteId(document),
    currentNotePath: getDocumentPath(document),
    lastSavedTitle: baseline?.content.title ?? '',
    lastSavedMarkdown: baseline?.content.markdown ?? '',
    lastSavedNoteId:
      baseline?.identity.kind === 'persisted'
        ? baseline.identity.noteId
        : null,
    lastSavedPath:
      baseline?.identity.kind === 'persisted'
        ? baseline.identity.path
        : null
  };
}

export function documentHasCleanBuffer(
  document: NoteDraftState
) {
  const baseline = document.savedBaseline;
  if (!baseline) {
    return (
      document.identity.kind === 'draft' &&
      document.working.title === '' &&
      document.working.markdown === ''
    );
  }
  return (
    contentEquals(document.working, baseline.content) &&
    identityEquals(document.identity, baseline.identity)
  );
}

export function documentHasUnresolvedConflict(
  document: NoteDraftState
) {
  return document.externalSync.kind === 'conflict';
}

function advanceRevision(document: NoteDraftState) {
  dispatchDocumentOperation(document, {
    type: 'contentChanged'
  });
}

export function updateDocumentTitle(
  document: NoteDraftState,
  title: string
) {
  if (document.working.title === title) return false;
  document.working.title = title;
  advanceRevision(document);
  return true;
}

export function updateDocumentMarkdown(
  document: NoteDraftState,
  markdown: string
) {
  if (document.working.markdown === markdown) return false;
  document.working.markdown = markdown;
  advanceRevision(document);
  return true;
}

export function dispatchDocumentOperation(
  document: NoteDraftState,
  event: DocumentOperationEvent
) {
  const previous = document.operation;
  document.operation = transitionDocumentOperation(previous, event);
  return document.operation !== previous;
}

export function dispatchDocumentExternalSync(
  document: NoteDraftState,
  event: DocumentExternalSyncEvent
) {
  const previous = document.externalSync;
  document.externalSync = transitionDocumentExternalSync(
    previous,
    event
  );
  return document.externalSync !== previous;
}

export function isDocumentOperationCurrent(
  document: NoteDraftState,
  token: number
) {
  return isDocumentOperationTokenCurrent(
    document.operation,
    token
  );
}

export function applySessionSnapshotToDocument(
  document: NoteDraftState,
  snapshot: SessionSnapshot,
  {
    preserveWorking = false
  }: { preserveWorking?: boolean } = {}
) {
  const external = externalDocumentSnapshotFromSession(
    snapshot
  );
  const titleChanged =
    !preserveWorking &&
    document.working.title !== external.content.title;
  const markdownChanged =
    !preserveWorking &&
    document.working.markdown !== external.content.markdown;

  document.identity = external.identity;
  document.savedBaseline = external.savedBaseline;
  if (!preserveWorking) {
    document.working = { ...external.content };
  }
  if (titleChanged || markdownChanged) {
    advanceRevision(document);
  }
  dispatchDocumentExternalSync(document, {
    type: 'boundaryApplied'
  });
  return { titleChanged, markdownChanged };
}

export function externalSnapshotMatchesSavedBaseline(
  document: NoteDraftState,
  snapshot: SessionSnapshot
) {
  const external = externalDocumentSnapshotFromSession(
    snapshot
  );
  const baseline = document.savedBaseline;
  return Boolean(
    baseline &&
      contentEquals(baseline.content, external.content) &&
      identityEquals(baseline.identity, external.identity)
  );
}

export function resolveConflictUsingExternal(
  document: NoteDraftState,
  conflictId: number
) {
  if (
    !isDocumentExternalConflictCurrent(
      document.externalSync,
      conflictId,
      'applyingExternal'
    )
  ) {
    return false;
  }
  const sync = document.externalSync;
  if (sync.kind !== 'conflict') return false;
  const external = sync.external;
  if (external.kind === 'snapshot') {
    const previous = document.working;
    document.working = {
      ...external.document.content
    };
    document.identity = external.document.identity;
    document.savedBaseline =
      external.document.savedBaseline;
    if (!contentEquals(previous, document.working)) {
      advanceRevision(document);
    }
    return dispatchDocumentExternalSync(document, {
      type: 'externalApplied',
      conflictId
    });
  }

  document.identity = { kind: 'draft' };
  document.savedBaseline = null;
  advanceRevision(document);
  return dispatchDocumentExternalSync(document, {
    type: 'externalApplied',
    conflictId
  });
}

export type DocumentStatusViewModel =
  | { kind: 'idle'; label: 'Saved' }
  | { kind: 'dirty'; label: 'Unsaved changes' }
  | { kind: 'busy'; label: string }
  | { kind: 'failed'; label: string }
  | {
      kind: 'conflict';
      label: 'Changed outside the app';
      externalKind: ExternalDocumentChange['kind'];
    };

export function getDocumentStatusViewModel(
  document: NoteDraftState
): DocumentStatusViewModel {
  if (document.externalSync.kind === 'conflict') {
    return {
      kind: 'conflict',
      label: 'Changed outside the app',
      externalKind: document.externalSync.external.kind
    };
  }
  if (document.operation.kind === 'failed') {
    return {
      kind: 'failed',
      label: document.operation.message
    };
  }
  if (document.operation.kind !== 'idle') {
    return {
      kind: 'busy',
      label: document.operation.kind
    };
  }
  return !documentHasCleanBuffer(document)
    ? { kind: 'dirty', label: 'Unsaved changes' }
    : { kind: 'idle', label: 'Saved' };
}

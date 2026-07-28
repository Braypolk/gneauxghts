import type { SessionSnapshot } from '$lib/features/notepad/session/session';

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

export type DocumentOperationKind =
  | 'saving'
  | 'remembering'
  | 'forgetting'
  | 'opening';

interface DocumentOperationBase {
  token: number;
  revision: number;
}

export type DocumentOperationState =
  | (DocumentOperationBase & { kind: 'idle' })
  | (DocumentOperationBase & {
      kind: DocumentOperationKind;
    })
  | (DocumentOperationBase & {
      kind: 'failed';
      failedOperation: DocumentOperationKind;
      message: string;
    });

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

export type DocumentExternalSyncState =
  | { kind: 'inSync' }
  | { kind: 'dirty' }
  | {
      kind: 'conflict';
      external: ExternalDocumentChange;
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
    operation: {
      kind: 'idle',
      token: 0,
      revision: 0
    },
    externalSync: { kind: 'inSync' }
  };
  document.externalSync = documentHasCleanBuffer(document)
    ? { kind: 'inSync' }
    : { kind: 'dirty' };
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

function updateExternalDirtyState(document: NoteDraftState) {
  if (document.externalSync.kind === 'conflict') return;
  document.externalSync = documentHasCleanBuffer(document)
    ? { kind: 'inSync' }
    : { kind: 'dirty' };
}

function advanceRevision(document: NoteDraftState) {
  document.operation = {
    ...document.operation,
    revision: document.operation.revision + 1
  };
}

export function updateDocumentTitle(
  document: NoteDraftState,
  title: string
) {
  if (document.working.title === title) return false;
  document.working.title = title;
  advanceRevision(document);
  updateExternalDirtyState(document);
  return true;
}

export function updateDocumentMarkdown(
  document: NoteDraftState,
  markdown: string
) {
  if (document.working.markdown === markdown) return false;
  document.working.markdown = markdown;
  advanceRevision(document);
  updateExternalDirtyState(document);
  return true;
}

export function beginDocumentOperation(
  document: NoteDraftState,
  kind: DocumentOperationKind
) {
  const token = document.operation.token + 1;
  document.operation = {
    kind,
    token,
    revision: document.operation.revision
  };
  return token;
}

export function invalidateDocumentOperations(
  document: NoteDraftState
) {
  document.operation = {
    kind: 'idle',
    token: document.operation.token + 1,
    revision: document.operation.revision
  };
}

export function isDocumentOperationCurrent(
  document: NoteDraftState,
  token: number
) {
  return document.operation.token === token;
}

export function completeDocumentOperation(
  document: NoteDraftState,
  token: number
) {
  if (!isDocumentOperationCurrent(document, token)) {
    return false;
  }
  document.operation = {
    kind: 'idle',
    token,
    revision: document.operation.revision
  };
  return true;
}

export function failDocumentOperation(
  document: NoteDraftState,
  failedOperation: DocumentOperationKind,
  error: unknown,
  token: number = document.operation.token
) {
  if (!isDocumentOperationCurrent(document, token)) {
    return false;
  }
  document.operation = {
    kind: 'failed',
    failedOperation,
    message:
      error instanceof Error
        ? error.message
        : String(error),
    token: document.operation.token,
    revision: document.operation.revision
  };
  return true;
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
  document.externalSync = documentHasCleanBuffer(document)
    ? { kind: 'inSync' }
    : { kind: 'dirty' };
  return { titleChanged, markdownChanged };
}

export function captureExternalSnapshotConflict(
  document: NoteDraftState,
  snapshot: SessionSnapshot,
  source: ExternalRefreshSource
) {
  document.externalSync = {
    kind: 'conflict',
    external: {
      kind: 'snapshot',
      source,
      document: externalDocumentSnapshotFromSession(snapshot)
    }
  };
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

export function captureExternalDeletionConflict(
  document: NoteDraftState,
  path: string,
  source: ExternalRefreshSource
) {
  document.externalSync = {
    kind: 'conflict',
    external: {
      kind: 'deletion',
      source,
      path
    }
  };
}

export function resolveConflictKeepingWorking(
  document: NoteDraftState
) {
  if (document.externalSync.kind !== 'conflict') return false;
  document.externalSync = { kind: 'dirty' };
  return true;
}

export function resolveConflictUsingExternal(
  document: NoteDraftState
) {
  if (document.externalSync.kind !== 'conflict') return false;
  const external = document.externalSync.external;
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
    document.externalSync = { kind: 'inSync' };
    return true;
  }

  document.identity = { kind: 'draft' };
  document.savedBaseline = null;
  advanceRevision(document);
  document.externalSync = { kind: 'dirty' };
  return true;
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
  return document.externalSync.kind === 'dirty'
    ? { kind: 'dirty', label: 'Unsaved changes' }
    : { kind: 'idle', label: 'Saved' };
}

import type { SessionSnapshot } from '$lib/features/notepad/session/session';
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';
import type { NoteSession } from '$lib/features/notepad/model/types';
import {
  createDocumentOperationState,
  isDocumentOperationTokenCurrent,
  transitionDocumentOperation,
  type DocumentOperationEvent,
  type DocumentOperationKind,
  type DocumentOperationState,
  type SaveWaitReason
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

/** Opaque identity for one in-memory open-document lifetime. */
export type DocumentHandle = `document:${string}`;

export interface DocumentWorkingContent {
  tags?: string[];
  tagsError?: string;
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

export interface DocumentPublicationState {
  warning: CommittedMutationWarning | null;
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
  readonly handle: DocumentHandle;
  working: DocumentWorkingContent;
  identity: DocumentIdentity;
  savedBaseline: DocumentSavedBaseline | null;
  operation: DocumentOperationState;
  externalSync: DocumentExternalSyncState;
  publication: DocumentPublicationState;
  canonicalCollision: {
    otherHandle: DocumentHandle;
    noteId: string | null;
    path: string;
  } | null;
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

export function tagsEqual(left: string[] = [], right: string[] = []) {
  return left.length === right.length && left.every((tag) => right.includes(tag));
}

function contentEquals(
  left: DocumentWorkingContent,
  right: DocumentWorkingContent
) {
  return (
    left.title === right.title &&
    left.markdown === right.markdown &&
    tagsEqual(left.tags, right.tags)
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
      ...(snapshot.tags ? { tags: [...snapshot.tags] } : {}),
      ...(snapshot.tagsError ? { tagsError: snapshot.tagsError } : {}),
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
            ...(snapshot.lastSavedTags ? { tags: [...snapshot.lastSavedTags] } : {}),
            markdown: snapshot.lastSavedMarkdown
          },
          identity: baselineIdentity
        }
      : null
  };
}

export function externalDocumentSnapshotFromCommittedNote(
  committed: NoteSession
): ExternalDocumentSnapshot {
  const identity = identityFromBoundary(
    committed.noteId,
    committed.path
  );
  const content = {
    title: committed.title,
    ...(committed.tags ? { tags: [...committed.tags] } : {}),
    ...(committed.tagsError ? { tagsError: committed.tagsError } : {}),
    markdown: committed.markdown
  };
  return {
    content,
    identity,
    savedBaseline: committed.path || committed.noteId
      ? { content: { ...content }, identity }
      : null
  };
}

export function createDocumentState(
  snapshot: SessionSnapshot,
  handle: DocumentHandle
): NoteDraftState {
  const external = externalDocumentSnapshotFromSession(
    snapshot
  );
  const document: NoteDraftState = {
    handle,
    working: { ...external.content },
    identity: external.identity,
    savedBaseline: external.savedBaseline,
    operation: createDocumentOperationState(),
    externalSync: createDocumentExternalSyncState(),
    publication: { warning: snapshot.commitWarning ?? null },
    canonicalCollision: null
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
    ...(document.working.tags ? { tags: [...document.working.tags] } : {}),
    ...(document.working.tagsError ? { tagsError: document.working.tagsError } : {}),
    ...(baseline?.content.tags ? { lastSavedTags: [...baseline.content.tags] } : {}),
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
        : null,
    ...(document.publication.warning
      ? { commitWarning: document.publication.warning }
      : {})
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
      document.working.markdown === '' &&
      (document.working.tags?.length ?? 0) === 0
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
  return (
    document.externalSync.kind === 'conflict' ||
    document.canonicalCollision !== null
  );
}

/** A collision participant can leave only when closing cannot discard edits. */
export function documentCanLeaveWithoutCanonicalWrite(
  document: NoteDraftState
) {
  return (
    document.canonicalCollision !== null &&
    document.externalSync.kind !== 'conflict' &&
    documentHasCleanBuffer(document)
  );
}

function advanceRevision(document: NoteDraftState) {
  dispatchDocumentOperation(document, {
    type: 'contentChanged'
  });
}

export function updateDocumentTags(document: NoteDraftState, tags: string[]) {
  if (tagsEqual(document.working.tags, tags)) return false;
  document.working.tags = [...tags];
  advanceRevision(document);
  return true;
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
  const next = transitionDocumentExternalSync(previous, event);
  if (next === previous) return false;
  if (event.type === 'keepWorking' && previous.kind === 'conflict') {
    const tagsEdited = !tagsEqual(document.working.tags, document.savedBaseline?.content.tags);
    if (previous.external.kind === 'snapshot') {
      const external = previous.external.document.content;
      // Invalid YAML cannot accept a tag patch, even after an explicit choice.
      // Leave the conflict intact so a failed resolution cannot lose intent.
      if (tagsEdited && external.tagsError) throw new Error(external.tagsError);
      if (!tagsEdited) {
        // Body-only edits still preserve independently changed disk metadata.
        const tagsChanged = !tagsEqual(document.working.tags, external.tags);
        document.working.tags = external.tags ? [...external.tags] : undefined;
        document.working.tagsError = external.tagsError;
        if (tagsChanged) advanceRevision(document);
      }
    }
    // Keep local content, but compare publication with the disk version the
    // user explicitly chose to replace. Deletion has no saved tag baseline.
    document.savedBaseline = previous.external.kind === 'snapshot'
      ? previous.external.document.savedBaseline
      : null;
  }
  document.externalSync = next;
  return true;
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
    preserveWorking = false,
    preserveTags = preserveWorking && !tagsEqual(document.working.tags, document.savedBaseline?.content.tags)
  }: { preserveWorking?: boolean; preserveTags?: boolean } = {}
) {
  const external = externalDocumentSnapshotFromSession(
    snapshot
  );
  const tagsChanged = !preserveTags && !tagsEqual(document.working.tags, external.content.tags);
  const titleChanged =
    !preserveWorking &&
    document.working.title !== external.content.title;
  const markdownChanged =
    !preserveWorking &&
    document.working.markdown !== external.content.markdown;

  document.identity = external.identity;
  document.savedBaseline = external.savedBaseline;
  document.publication.warning = snapshot.commitWarning ?? null;
  if (!preserveWorking) {
    document.working = { ...external.content };
  } else if (!preserveTags) {
    document.working.tags = external.content.tags ? [...external.content.tags] : undefined;
    document.working.tagsError = external.content.tagsError;
  }
  if (titleChanged || markdownChanged || tagsChanged) {
    advanceRevision(document);
  }
  dispatchDocumentExternalSync(document, {
    type: 'boundaryApplied'
  });
  return { titleChanged, markdownChanged };
}

export function applyCommittedNoteToDocument(
  document: NoteDraftState,
  committed: NoteSession,
  {
    preserveWorking = false,
    preserveTags = preserveWorking && !tagsEqual(document.working.tags, document.savedBaseline?.content.tags)
  }: { preserveWorking?: boolean; preserveTags?: boolean } = {}
) {
  const external = externalDocumentSnapshotFromCommittedNote(
    committed
  );
  const tagsChanged = !preserveTags && !tagsEqual(document.working.tags, external.content.tags);
  const titleChanged =
    !preserveWorking &&
    document.working.title !== external.content.title;
  const markdownChanged =
    !preserveWorking &&
    document.working.markdown !== external.content.markdown;

  document.identity = external.identity;
  document.savedBaseline = external.savedBaseline;
  document.publication.warning = committed.commitWarning ?? null;
  if (!preserveWorking) {
    document.working = { ...external.content };
  } else if (!preserveTags) {
    document.working.tags = external.content.tags ? [...external.content.tags] : undefined;
    document.working.tagsError = external.content.tagsError;
  }
  if (titleChanged || markdownChanged || tagsChanged) {
    advanceRevision(document);
  }
  dispatchDocumentExternalSync(document, {
    type: 'boundaryApplied'
  });
  return { titleChanged, markdownChanged };
}

export function restoreTransientDraftToDocument(
  document: NoteDraftState,
  content: DocumentWorkingContent,
  identity: { noteId: string | null; path: string | null }
) {
  const tagsChanged = !tagsEqual(document.working.tags, content.tags);
  const titleChanged = document.working.title !== content.title;
  const markdownChanged =
    document.working.markdown !== content.markdown;
  document.working = { ...content };
  document.identity = identityFromBoundary(
    identity.noteId,
    identity.path
  );
  document.savedBaseline = null;
  document.publication.warning = null;
  if (titleChanged || markdownChanged || tagsChanged) {
    advanceRevision(document);
  }
  dispatchDocumentExternalSync(document, {
    type: 'boundaryApplied'
  });
  return { titleChanged, markdownChanged };
}

export function externalSnapshotMatchesSavedBaseline(
  document: NoteDraftState,
  committed: NoteSession
) {
  const external = externalDocumentSnapshotFromCommittedNote(
    committed
  );
  const baseline = document.savedBaseline;
  return Boolean(
    baseline &&
    contentEquals(baseline.content, external.content) &&
    document.working.tagsError === external.content.tagsError &&
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
  | { kind: 'busy'; label: string; historyWaiting?: true }
  | { kind: 'failed'; label: string }
  | {
      kind: 'warning';
      label: string;
      hasUnsavedChanges: boolean;
      repairAction: 'historySettings' | 'automatic';
    }
  | {
      kind: 'conflict';
      label: 'Changed outside the app';
      externalKind: ExternalDocumentChange['kind'];
    }
  | {
      kind: 'canonicalCollision';
      label: 'Saved note is open in another draft';
      path: string;
    };

export function getDocumentStatusViewModel(
  document: NoteDraftState
): DocumentStatusViewModel {
  if (document.canonicalCollision) {
    return {
      kind: 'canonicalCollision',
      label: 'Saved note is open in another draft',
      path: document.canonicalCollision.path
    };
  }
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
      ...(document.operation.kind === 'saving' && document.operation.waitReason
        ? { historyWaiting: true as const } : {}),
      label: document.operation.kind === 'saving'
        ? saveProgressLabel(document.operation.waitReason)
        : 'Forgetting…'
    };
  }
  if (document.publication.warning) {
    return {
      kind: 'warning',
      label: document.publication.warning.message,
      hasUnsavedChanges: !documentHasCleanBuffer(document),
      repairAction: document.publication.warning.issues.some(
        (issue) => issue.stage === 'historyFinalization'
      )
        ? 'historySettings'
        : 'automatic'
    };
  }
  return !documentHasCleanBuffer(document)
    ? { kind: 'dirty', label: 'Unsaved changes' }
    : { kind: 'idle', label: 'Saved' };
}

function saveProgressLabel(reason?: SaveWaitReason) {
  switch (reason) {
    case 'recovery': return 'Unsaved changes — recovering history before saving…';
    case 'verification': return 'Unsaved changes — checking this note’s history before saving…';
    case 'unavailable': return 'Unsaved changes — history is unavailable. Retry history from Settings.';
    case 'corrupt': return 'Unsaved changes — history needs repair. Open Settings for recovery.';
    default: return 'Saving…';
  }
}

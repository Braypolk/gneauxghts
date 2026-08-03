import {
  dispatchDocumentExternalSync,
  externalDocumentSnapshotFromSession,
  type ExternalRefreshSource,
  type NoteDraftState
} from './documentState';
import type { SessionSnapshot } from '$lib/features/notepad/session/session';

export function captureExternalSnapshotForTest(
  document: NoteDraftState,
  snapshot: SessionSnapshot,
  source: ExternalRefreshSource
) {
  dispatchDocumentExternalSync(document, {
    type: 'externalCaptured',
    external: {
      kind: 'snapshot',
      source,
      document: externalDocumentSnapshotFromSession(snapshot)
    }
  });
  return document.externalSync.kind === 'conflict'
    ? document.externalSync.conflictId
    : null;
}

export function captureExternalDeletionForTest(
  document: NoteDraftState,
  path: string,
  source: ExternalRefreshSource
) {
  dispatchDocumentExternalSync(document, {
    type: 'externalCaptured',
    external: { kind: 'deletion', source, path }
  });
  return document.externalSync.kind === 'conflict'
    ? document.externalSync.conflictId
    : null;
}

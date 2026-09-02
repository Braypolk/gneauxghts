import { invoke } from '@tauri-apps/api/core';
import {
  documentHasCleanBuffer,
  documentHasUnresolvedConflict,
  getDocumentMarkdown,
  getDocumentNoteId,
  getDocumentPath,
  type NoteDraftState
} from '$lib/features/notepad/document/documentState';
import type {
  OpenTaskDocumentMutationHandler,
  TaskDocumentMutationKind
} from './taskMutationGateway';

interface PreparedTaskDocumentMutation {
  taskId: string;
  noteId: string;
  notePath: string;
  baseHash: string;
  updatedEditorMarkdown: string;
}

export interface OpenDocumentTaskMutationDeps {
  findReferencedDocument: (
    noteId: string,
    notePath: string
  ) => NoteDraftState | null;
  replaceMarkdown: (
    document: NoteDraftState,
    markdown: string
  ) => Promise<void>;
  attributeTaskActionSave?: (
    document: NoteDraftState,
    expectedMarkdown: string
  ) => (() => void) | void;
  saveDocument: (document: NoteDraftState) => Promise<void>;
  prepare?: (request: {
    taskId: string;
    mutationKind: TaskDocumentMutationKind;
    workingMarkdown: string;
    bodyHash: string;
  }) => Promise<PreparedTaskDocumentMutation>;
  hashMarkdown?: (markdown: string) => Promise<string>;
  maxPrepareAttempts?: number;
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function defaultPrepare(request: {
  taskId: string;
  mutationKind: TaskDocumentMutationKind;
  workingMarkdown: string;
  bodyHash: string;
}) {
  return invoke<PreparedTaskDocumentMutation>(
    'prepare_task_document_mutation',
    request
  );
}

function preparedTargetMatches(
  prepared: PreparedTaskDocumentMutation,
  document: NoteDraftState,
  taskId: string
) {
  return (
    prepared.taskId === taskId &&
    prepared.noteId === getDocumentNoteId(document) &&
    prepared.notePath === getDocumentPath(document)
  );
}

/**
 * Applies task mutations to a dirty open document, then crosses the ordinary
 * document save boundary. The backend prepare command is non-writing and uses
 * the same pure transform as canonical task commands.
 */
export function createOpenDocumentTaskMutationHandler(
  deps: OpenDocumentTaskMutationDeps
): OpenTaskDocumentMutationHandler {
  const prepare = deps.prepare ?? defaultPrepare;
  const hashMarkdown = deps.hashMarkdown ?? sha256Text;
  const maxPrepareAttempts = Math.max(1, deps.maxPrepareAttempts ?? 2);

  return async ({ kind, taskId, noteId, notePath }) => {
    let document = deps.findReferencedDocument(noteId, notePath);
    if (!document || documentHasCleanBuffer(document)) {
      return { status: 'use-canonical-command' };
    }
    if (documentHasUnresolvedConflict(document)) {
      throw new Error(
        'Resolve the note’s external-change conflict before changing its tasks.'
      );
    }

    for (let attempt = 0; attempt < maxPrepareAttempts; attempt += 1) {
      const expectedDocument = document;
      const expectedKey = document.key;
      const expectedRevision = document.operation.revision;
      const workingMarkdown = getDocumentMarkdown(document);
      const bodyHash = await hashMarkdown(workingMarkdown);
      const prepared = await prepare({
        taskId,
        mutationKind: kind,
        workingMarkdown,
        bodyHash
      });

      document = deps.findReferencedDocument(noteId, notePath);
      const targetIsCurrent =
        document === expectedDocument &&
        document.key === expectedKey &&
        document.operation.revision === expectedRevision &&
        getDocumentMarkdown(document) === workingMarkdown &&
        !documentHasUnresolvedConflict(document);

      if (!targetIsCurrent) {
        if (!document || documentHasCleanBuffer(document)) {
          return { status: 'use-canonical-command' };
        }
        if (documentHasUnresolvedConflict(document)) {
          throw new Error(
            'Resolve the note’s external-change conflict before changing its tasks.'
          );
        }
        continue;
      }
      if (!document) {
        return { status: 'use-canonical-command' };
      }
      if (
        prepared.baseHash !== bodyHash ||
        !preparedTargetMatches(prepared, document, taskId)
      ) {
        throw new Error(
          'The task target changed while its note was being prepared.'
        );
      }

      const cancelTaskAttribution = deps.attributeTaskActionSave?.(
        document,
        prepared.updatedEditorMarkdown
      );
      try {
        await deps.replaceMarkdown(
          document,
          prepared.updatedEditorMarkdown
        );
      } catch (error) {
        cancelTaskAttribution?.();
        throw error;
      }
      await deps.saveDocument(document);
      return { status: 'applied-to-open-document' };
    }

    throw new Error(
      'The note kept changing while the task update was being prepared. Try again.'
    );
  };
}

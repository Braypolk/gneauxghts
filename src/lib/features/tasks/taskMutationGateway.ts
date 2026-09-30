export type TaskDocumentMutationKind = 'toggle' | 'delete' | 'setDueDate';

export interface TaskDocumentMutationRequest {
  kind: TaskDocumentMutationKind;
  taskId: string;
  noteId: string;
  notePath: string;
  dueDate?: string | null;
}

export type TaskDocumentMutationResult =
  | { status: 'use-canonical-command' }
  | { status: 'applied-to-open-document' };

export type OpenTaskDocumentMutationHandler = (
  request: TaskDocumentMutationRequest
) => Promise<TaskDocumentMutationResult>;

let openDocumentHandler: OpenTaskDocumentMutationHandler | null = null;

/**
 * Registers the notepad's open-document mutation boundary. The task feature
 * remains independent of notepad internals and falls back to the canonical
 * backend command whenever the notepad is not mounted or the note is clean.
 */
export function registerOpenTaskDocumentMutationHandler(
  handler: OpenTaskDocumentMutationHandler
) {
  openDocumentHandler = handler;

  return () => {
    if (openDocumentHandler === handler) {
      openDocumentHandler = null;
    }
  };
}

export async function routeTaskDocumentMutation(
  request: TaskDocumentMutationRequest
): Promise<TaskDocumentMutationResult> {
  return openDocumentHandler
    ? openDocumentHandler(request)
    : { status: 'use-canonical-command' };
}

export type TaskMutationPayload = 'toggle' | 'delete' | { setDueDate: { dueDate: string | null } };

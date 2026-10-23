import { defineDoc, type TaskId, type ToolExecutionApi } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord/context';
import type { JsonValue } from '@earendil-works/chord';
import { readNote, noteReadOutput, type ResolveNoteAuthority } from './notes';
import { EditReviewDoc, prepareMutation, publicationIntent, PublicationTask, type PublicationTaskResult, type Mutation, type PreparedMutation } from './publication';

// Keep the established task document kind so pending edit/create calls reopen
// their existing publication child after this shared adapter extraction.
const MutationCallDoc = defineDoc({ kind: 'gneauxghts.editCall', version: 1, scope: 'task', initial: (): { publicationTaskId: number | null } => ({ publicationTaskId: null }) });
const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

export type EditCandidate = { title: string; patch: string; mutation: Extract<Mutation, { operation: 'update' }> };
type Candidate = EditCandidate | { title: string; mutation: Extract<Mutation, { operation: 'create' | 'rename' }> };
/** All note mutations use one Pi child task and native publication protocol. */
export async function publishCandidate(api: ToolExecutionApi, context: Context, resolveAuthority: ResolveNoteAuthority,
  mutationKind: 'edit' | 'create' | 'rename', build: (authorityId: string) => Promise<Candidate>) {
  const { kind, action, completed } = {
    edit: { kind: 'noteEdit', action: 'edit', completed: 'updated' },
    create: { kind: 'noteCreate', action: 'creation', completed: 'created' },
    rename: { kind: 'noteRename', action: 'rename', completed: 'renamed' }
  }[mutationKind];
  try {
    const authorityId = await resolveAuthority(api, context);
    let child = (await api.snapshot(MutationCallDoc, api.taskId, context))?.publicationTaskId;
    if (child === undefined || child === null) {
      const candidate = await build(authorityId);
      const prepared = await prepareMutation(authorityId, `pi-${mutationKind}:${api.taskId}`, candidate.mutation);
      const review = prepared.reviewRequired ? { payloadHash: prepared.payloadHash } : undefined;
      const presentation = review ? reviewPresentation(candidate, prepared) : undefined;
      child = await api.commit(async tx => {
        const doc = await tx.doc(MutationCallDoc, api.taskId);
        if (doc.publicationTaskId === null) {
          doc.publicationTaskId = await tx.createTask(PublicationTask,
            publicationIntent(authorityId, prepared),
            { conversationId: api.conversationId, ownership: { kind: 'task', taskId: api.taskId } });
          if (review) (await tx.doc(EditReviewDoc, api.conversationId)).items[String(doc.publicationTaskId)] = {
            taskId: doc.publicationTaskId, title: candidate.title, decision: 'pending',
            ...presentation!
          };
        }
        return doc.publicationTaskId;
      }, context);
    }
    const settled = await api.waitForTask(child as TaskId<PublicationTaskResult>, context);
    if (settled.state.outcome.status !== 'completed') {
      const detail = settled.state.outcome.error?.detail;
      const code = detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.code === 'string' ? detail.code : undefined;
      const result = { status: settled.state.outcome.status, ...(code ? { code } : {}),
        message: settled.state.outcome.error?.message ?? 'Publication did not complete. Do not infer a write from cancellation.' };
      return { isError: true, output: output(result), details: { kind, ...result } };
    }
    const result = settled.state.outcome.result;
    const details = { kind, ...result };
    if (result.status !== 'committed') return { isError: true, output: output(result), details };
    try {
      const read = await readNote(await resolveAuthority(api, context), result.noteId);
      return { output: output({ ...result, read: noteReadOutput(read) }), details: { ...details, source: read.source } as unknown as JsonValue };
    } catch (error) {
      if (context.abortSignal?.aborted) throw error;
      // Read failure cannot turn a proven commit into a failed/uncertain write.
      return { output: output({ ...result, readError: `The ${action} committed, but the ${completed} note could not be read. Use read_note before describing or citing its current content.` }), details };
    }
  } catch (error) {
    if (context.abortSignal?.aborted) throw error;
    const message = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Note publication is unavailable.';
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const result = { status: 'blocked', ...(code ? { code } : {}), message };
    return { isError: true, output: output(result), details: { kind, ...result } };
  }
}

function reviewPresentation(candidate: Candidate, prepared: PreparedMutation) {
  switch (prepared.operation) {
    case 'update':
      if (!('patch' in candidate)) throw new Error('The prepared operation does not match the edit candidate.');
      return { kind: 'edit' as const, patch: candidate.patch };
    case 'create': return { kind: 'create' as const, ...prepared.creation };
    case 'rename': return { kind: 'rename' as const, ...prepared.rename };
  }
}

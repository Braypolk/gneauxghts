import { invoke } from './nativeInvoke';
import { defineDoc, defineExtension, defineTask, type Harness, type ConversationId, type TaskId, type TaskRecord } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';
import type { AgentPublicationTarget, DocumentEditingService } from '$lib/features/notepad/document/documentEditingService';
import { DocumentPublicationBlocked } from '$lib/features/notepad/document/documentPublicationAdmission';
import type { AuthoritySnapshot, WritePolicy } from './authority';

export type Mutation = { operation: 'create'; folder: string; title: string; markdown: string } | { operation: 'update'; noteId: string; expectedReadSourceId: string; markdown: string };
export type PreparedMutation = { intentId: string; payloadHash: string; reviewRequired: boolean; target: AgentPublicationTarget; creation?: { destination: string; markdown: string } };
export type PublicationResult =
  | { status: 'committed'; receiptId: string; noteId: string; path: string; markdown: string; commitWarning?: CommittedMutationWarning }
  | { status: 'blocked'; code: string; message: string };
export type ReconciliationResult = PublicationResult | { status: 'unpublished' };
/** Pi retains receipt/note references and warning presentation; canonical content/proof stay native-owned. */
export type PublicationTaskResult =
  | { status: 'committed'; receiptId: string; noteId: string; commitWarning?: Pick<CommittedMutationWarning, keyof CommittedMutationWarning> }
  | { status: 'blocked'; code: string; message: string };
export type CommittedEdit = Extract<PublicationTaskResult, { status: 'committed' }>;
export type PublicationIntent = { authorityId: string; intentId: string; target: AgentPublicationTarget;
  review?: { payloadHash: string } };
export type EditReview = { taskId: number; title: string; decision: 'pending' | 'approved' | 'rejected' } & (
  | { kind: 'edit'; patch: string }
  | { kind: 'create'; destination: string; markdown: string }
);
export const EditReviewDoc = defineDoc({ kind: 'gneauxghts.editReviews', version: 2, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: (): { items: Record<string, EditReview> } => ({ items: {} }),
  migrate(value, fromVersion) {
    if (fromVersion !== 1) throw new Error('Unsupported note review version.');
    // Preserve pending decisions across this shape change; rendering and task
    // progression consume only the current discriminated representation.
    const items = value.items as Record<string, { taskId: number; title: string; decision: EditReview['decision']; patch: string; creation?: { destination: string; markdown: string } }>;
    return { items: Object.fromEntries(Object.entries(items).map(([key, { taskId, title, decision, patch, creation }]) => [key,
      { taskId, title, decision, ...(creation ? { kind: 'create' as const, ...creation } : { kind: 'edit' as const, patch }) }
    ])) };
  } });

/** User decisions change Pi working state; native approval still binds the exact payload. */
export async function decideEditReview(harness: Harness, conversationId: ConversationId, taskId: number, decision: 'approved' | 'rejected') {
  await harness.commit(async tx => {
    const task = await tx.task(taskId as TaskId);
    if (!task || task.conversationId !== conversationId || task.state.status === 'terminal' || task.abortRequested) throw new Error('This edit is no longer awaiting review.');
    const doc = await tx.doc(EditReviewDoc, conversationId);
    const review = doc.items[String(taskId)];
    if (!review || review.decision !== 'pending') throw new Error('This edit was already reviewed.');
    review.decision = decision;
  }, BACKGROUND_CONTEXT);
}
type DocumentOwner = Pick<DocumentEditingService<string>, 'withAgentPublication' | 'releaseSettledAgentPublication'>;
type NativeCall = typeof invoke;
type BoundOwner = { ownerId: string; document: DocumentOwner; native: NativeCall; closed: boolean; closing?: Promise<void>; operations: Set<Promise<unknown>> };
let bound: BoundOwner | undefined;
type OwnerAvailability = { owner: BoundOwner } | { error: unknown };
let available = Promise.withResolvers<OwnerAvailability>();
let binding = false;
let bindingFailed = false;
let retiringWorkspace: Promise<void> | undefined;

export const prepareMutation = (authorityId: string, requestId: string, mutation: Mutation) =>
  invoke<PreparedMutation>('pi_chat_prepare_mutation', { authorityId, requestId, mutation });
export const approveMutation = (authorityId: string, intentId: string, payloadHash: string) =>
  invoke<void>('pi_chat_approve_mutation', { authorityId, intentId, payloadHash });
export const rejectMutation = (authorityId: string, intentId: string) =>
  invoke<void>('pi_chat_reject_mutation', { authorityId, intentId });
export const setWritePolicy = (authorityId: string, expectedRevision: number, write: WritePolicy) =>
  invoke<AuthoritySnapshot>('pi_chat_set_write_policy', { authorityId, expectedRevision, write });

/** Install the actual workspace owner for canonical agent publication. */
export async function bindPublicationDocumentOwner(document: DocumentOwner, native: NativeCall = invoke) {
  if (bound?.closed) {
    // A route may remount while the retired workspace still joins its effect and
    // canonical adoption. Only its confirmed close can release ownership.
    if (!bound.closing) throw new Error('The previous publication document owner did not finish closing.');
    await bound.closing;
  }
  if (bound || binding) throw new Error('A publication document owner is already bound.');
  binding = true;
  if (bindingFailed) { available = Promise.withResolvers<OwnerAvailability>(); bindingFailed = false; }
  let ownerId: string;
  try { ownerId = await native<string>('pi_chat_bind_editor_owner'); }
  catch (error) {
    bindingFailed = true;
    available.resolve({ error });
    throw error;
  } finally { binding = false; }
  const owner: BoundOwner = { ownerId, document, native, closed: false, operations: new Set() };
  if (bound) {
    await native('pi_chat_close_editor_owner', { ownerId });
    throw new Error('A publication document owner is already bound.');
  }
  bound = owner;
  available.resolve({ owner });
  return {
    close: () => owner.closing ??= (async () => {
      if (!owner.closed) {
        owner.closed = true;
        if (bound === owner) available = Promise.withResolvers<OwnerAvailability>();
      }
      // The native owner must join effects before the document root is released.
      await native('pi_chat_close_editor_owner', { ownerId });
      // Join canonical adoption before releasing roots for workspace disposal.
      await Promise.allSettled([...owner.operations]);
      document.releaseSettledAgentPublication();
      if (bound === owner) bound = undefined;
    })().catch(error => { owner.closing = undefined; throw error; })
  };
}

/** Synchronous route lifetime: withdrawal is recorded before replacement mount effects run. */
export function mountPublicationDocumentOwner(document: DocumentOwner, native: NativeCall = invoke) {
  const previousOwnerSettled = retiringWorkspace ?? Promise.resolve();
  const ready = previousOwnerSettled.then(() => bindPublicationDocumentOwner(document, native));
  let closing: Promise<void> | undefined;
  return {
    previousOwnerSettled,
    ready,
    close(disposeWorkspace: () => void = () => {}): Promise<void> {
      if (closing) return closing;
      // Install the join synchronously, including when the first native bind is
      // pending. A replacement never races that owner or its document adoption.
      const settlement = previousOwnerSettled
        .then(() => ready.then(owner => owner.close(), () => undefined))
        .then(disposeWorkspace);
      retiringWorkspace = settlement;
      return closing = settlement.then(() => {
        if (retiringWorkspace === settlement) retiringWorkspace = undefined;
      }, error => { closing = undefined; throw error; });
    }
  };
}

async function ownerFor(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (bound && !bound.closed) return bound;
  const waiting = !signal ? available.promise : new Promise<OwnerAvailability>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    available.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
  const result = await waiting;
  if ('error' in result) throw result.error;
  return result.owner;
}

/** Reconciliation precedes replay; only the native owner can establish a new effect. */
export async function publishPreparedMutation(intent: PublicationIntent, signal?: AbortSignal): Promise<PublicationResult> {
  const owner = await ownerFor(signal);
  if (owner.closed) throw new Error('The publication document owner is closing.');
  const operation = executePreparedMutation(owner, intent, signal);
  owner.operations.add(operation);
  try { return await operation; } finally { owner.operations.delete(operation); }
}

async function executePreparedMutation(owner: BoundOwner, intent: PublicationIntent, signal?: AbortSignal): Promise<PublicationResult> {
  const { native, ownerId, document } = owner;
  const prior = await native<ReconciliationResult>('pi_chat_reconcile_mutation', { intentId: intent.intentId });
  if (prior.status !== 'unpublished') return prior;
  signal?.throwIfAborted();
  let effectStarted = false;
  try {
    return await document.withAgentPublication(intent.target, async lease => {
      effectStarted = true;
      signal?.throwIfAborted();
      if (owner.closed) throw new Error('The publication document owner is closing.');
      const admissionId = await native<string>('pi_chat_admit_editor_publication', { ownerId, intentId: intent.intentId, target: intent.target });
      let result: PublicationResult | undefined;
      let failure: unknown;
      try {
        signal?.throwIfAborted();
        result = await native<PublicationResult>('pi_chat_publish_mutation', { authorityId: intent.authorityId, intentId: intent.intentId });
      } catch (error) { failure = error; }
      try {
        await native('pi_chat_release_editor_publication', { ownerId, admissionId });
      } catch (error) {
        lease.retainUntilSettled();
        throw error;
      }
      if (!result) {
        let recovered: ReconciliationResult;
        try { recovered = await native<ReconciliationResult>('pi_chat_reconcile_mutation', { intentId: intent.intentId }); }
        catch (error) { await lease.captureCanonical(); throw error; }
        if (recovered.status !== 'unpublished') result = recovered;
      }
      if (!result) { await lease.captureCanonical(); throw failure ?? new Error('The mutation has no confirmed publication outcome.'); }
      if (result.status === 'committed') {
        try { await lease.adopt(result); } catch (error) { await lease.captureCanonical(); throw error; }
      }
      return result;
    });
  } catch (error) {
    // Only a refusal before entering the effect proves that the editor blocked
    // this attempt. The same exception during receipt adoption is a real error.
    if (!effectStarted && error instanceof DocumentPublicationBlocked) return { status: 'blocked', code: 'editor_busy', message: error.message };
    throw error;
  }
}

function taskResult(result: PublicationResult): PublicationTaskResult {
  return result.status === 'committed' ? { status: 'committed', receiptId: result.receiptId, noteId: result.noteId, ...(result.commitWarning ? { commitWarning: result.commitWarning } : {}) } : result;
}

function publicationError(error: unknown, fallback: string) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : fallback;
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return { message, ...(code ? { detail: { code } } : {}) };
}

type PublicationCheckpoint = { phase: 'review' } | { phase: 'publish' };
export const PublicationTask = defineTask<PublicationIntent, PublicationCheckpoint, PublicationTaskResult>({
  name: 'gneauxghts.chat.publication', version: 3, initial: input => ({ phase: input.review ? 'review' : 'publish' }),
  phases: {
    review: async (task, runtime, context) => {
      const details = task.input.review!;
      const key = String(runtime.taskId);
      const watch = await runtime.watchDoc(EditReviewDoc, runtime.conversationId, context);
      if (!watch) throw new Error('Edit review is unavailable.');
      const decision = await new Promise<EditReview['decision']>((resolve, reject) => {
        const changed = (doc: { items: Record<string, EditReview> }) => {
          const value = doc.items[key]?.decision;
          if (value && value !== 'pending') resolve(value);
        };
        if (watch.value) changed(watch.value);
        watch.start(async value => { if (value) changed(value); });
        void watch.closed.then(() => reject(new Error('Edit review observation ended.')));
      });
      try {
        if (decision === 'rejected') await rejectMutation(task.input.authorityId, task.input.intentId);
        else await approveMutation(task.input.authorityId, task.input.intentId, details.payloadHash);
      } catch (error) {
        if (runtime.signal.aborted) throw error;
        await runtime.commit(async tx => {
          delete (await tx.doc(EditReviewDoc, runtime.conversationId)).items[key];
          return { status: 'terminal', outcome: { status: 'failed', error: publicationError(error, 'Native edit review is unavailable.') } };
        }, context);
        return;
      }
      if (decision === 'rejected') {
        await runtime.commit(async tx => {
          delete (await tx.doc(EditReviewDoc, runtime.conversationId)).items[key];
          return { status: 'terminal', outcome: { status: 'completed', result: { status: 'blocked', code: 'review_rejected', message: 'The user discarded this edit.' } } };
        }, context);
      } else {
        await runtime.commit(async tx => {
          delete (await tx.doc(EditReviewDoc, runtime.conversationId)).items[key];
          return { status: 'running', checkpoint: { phase: 'publish' } };
        }, context);
      }
    },
    publish: async (task, runtime, context) => {
      let result: PublicationResult;
      try { result = await publishPreparedMutation(task.input, runtime.signal); }
      catch (error) {
        if (runtime.signal.aborted) throw error;
        const failure = publicationError(error, 'Native edit publication is unavailable.');
        if (!failure.detail) throw error;
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'failed', error: failure } }), context);
        return;
      }
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: taskResult(result) } }), context);
    }
  },
  abort: async (task, runtime, context) => {
    let result: ReconciliationResult;
    try {
      result = await invoke<ReconciliationResult>('pi_chat_reconcile_mutation', { intentId: task.input.intentId });
      if (result.status === 'unpublished' && task.input.review) {
        try { await rejectMutation(task.input.authorityId, task.input.intentId); }
        catch (error) {
          // Retirement already forbids new effects. A rejection failure must not
          // prevent cancellation or leave a review card after the Pi task ends.
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'retired_authority')) runtime.report(error);
        }
      }
    } finally {
      await runtime.commit(async tx => {
        delete (await tx.doc(EditReviewDoc, runtime.conversationId)).items[String(runtime.taskId)];
        return undefined;
      }, context);
    }
    await runtime.commit(() => ({ status: 'terminal', outcome: result.status === 'committed'
      ? { status: 'completed', result: taskResult(result) }
      : { status: 'aborted', reason: 'Publication cancelled; no new effect is authorized.' } }), context);
  }
});
export const publicationExtension = () => defineExtension({ name: 'gneauxghts.publication', tasks: [PublicationTask] });

/** Presentation reads the settled Pi result; an aborted caller cannot undo a proven effect. */
export function committedPublicationResult(task: TaskRecord<JsonValue, JsonValue, JsonValue>): CommittedEdit | undefined {
  if (task.kind !== PublicationTask.definition.name || task.state.status !== 'terminal' || task.state.outcome.status !== 'completed') return;
  const result = task.state.outcome.result as PublicationTaskResult;
  return result.status === 'committed' ? result : undefined;
}

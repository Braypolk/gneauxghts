import { invoke } from './nativeInvoke';
import { defineExtension, defineTask } from '@earendil-works/pi-durable';
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';
import type { AgentPublicationTarget, DocumentEditingService } from '$lib/features/notepad/document/documentEditingService';
import type { AuthoritySnapshot, WritePolicy } from './authority';

export type Mutation =
  | { operation: 'create'; folder: string; title: string; markdown: string }
  | { operation: 'update'; noteId: string; expectedReadSourceId: string; markdown: string };
export type PreparedMutation = { intentId: string; payloadHash: string; reviewRequired: boolean; target: AgentPublicationTarget };
export type PublicationResult =
  | { status: 'committed'; receiptId: string; noteId: string; path: string; markdown: string; commitWarning?: CommittedMutationWarning }
  | { status: 'blocked'; code: string; message: string };
export type ReconciliationResult = PublicationResult | { status: 'unpublished' };
/** Pi checkpoints retain references; canonical content and warnings stay native-owned. */
export type PublicationTaskResult =
  | { status: 'committed'; receiptId: string }
  | { status: 'blocked'; code: string; message: string };
export type PublicationIntent = { authorityId: string; intentId: string; target: AgentPublicationTarget };
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

/** Install the actual workspace owner. The synthetic task and future writer share this path. */
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
  return document.withAgentPublication(intent.target, async lease => {
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
}

/** Registered as a task only: the initial model tool registry remains read-only. */
function taskResult(result: PublicationResult): PublicationTaskResult {
  return result.status === 'committed' ? { status: 'committed', receiptId: result.receiptId } : result;
}

export const PublicationTask = defineTask<PublicationIntent, { phase: 'publish' }, PublicationTaskResult>({
  name: 'gneauxghts.chat.publication', version: 1, initial: () => ({ phase: 'publish' }),
  phases: { publish: async (task, runtime, context) => {
    const result = await publishPreparedMutation(task.input, runtime.signal);
    await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: taskResult(result) } }), context);
  } },
  abort: async (task, runtime, context) => {
    const result = await invoke<ReconciliationResult>('pi_chat_reconcile_mutation', { intentId: task.input.intentId });
    await runtime.commit(() => ({ status: 'terminal', outcome: result.status === 'committed'
      ? { status: 'completed', result: taskResult(result) }
      : { status: 'aborted', reason: 'Publication cancelled; no new effect is authorized.' } }), context);
  }
});
export const publicationExtension = () => defineExtension({ name: 'gneauxghts.publication', tasks: [PublicationTask] });

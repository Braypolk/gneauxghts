import { get, writable } from 'svelte/store';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { withCancel } from '@earendil-works/chord/context';
import type { Op } from '@earendil-works/chord/delta';
import { AgentDoc, InboxDoc, LiveDoc, UsageDoc, UserEntry, type AgentState, type CommitPublication, type Conversation, type ConversationId, type ConversationView, type Cursor, type EntryRecord, type InboxState, type LiveState, type SubmissionId, type SubmissionRecord, type UsageState, type WatchEnd } from '@earendil-works/pi-durable';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import { ChatDoc, PI_CONTEXT, defaultReadPolicy, openPiChat, readPiChatSettings, type PiChat, type PiChatSettings, type PiConversationSummary } from '../pi/runtime';
import type { PiDiagnostics, PiDiagnosticSnapshot } from '../pi/diagnostics';
import { setReadPolicy, type AuthoritySnapshot, type ReadPolicy, type WritePolicy } from '../pi/authority';
import { EditReviewDoc, PublicationTask, committedPublicationResult, decideEditReview, setWritePolicy, type CommittedEdit, type EditReview } from '../pi/publication';

export function chatErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
export function messageText(message: Message): string {
  return typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
}
export function viewLive(view: ConversationView | null): LiveState {
  return (view?.docs[LiveDoc.definition.kind] ?? {}) as LiveState;
}
export function viewInbox(view: ConversationView | null): InboxState {
  return (view?.docs[InboxDoc.definition.kind] ?? { items: [] }) as InboxState;
}
export function viewUsage(view: ConversationView | null): UsageState | undefined {
  return view?.docs[UsageDoc.definition.kind] as UsageState | undefined;
}
export function mergeEntries(...groups: ReadonlyArray<readonly EntryRecord[]>): EntryRecord[] {
  const entries = new Map<number, EntryRecord>();
  for (const group of groups) for (const entry of group) entries.set(entry.id, entry);
  return [...entries.values()].sort((a, b) => a.id - b.id);
}
export type PiViewSnapshot = {
  initialized: boolean; loading: boolean; error: string | null; conversation: Conversation | null;
  title: string; view: ConversationView | null; entries: EntryRecord[]; historyNext?: Cursor;
  conversations: PiConversationSummary[]; listNext?: Cursor; authority?: AuthoritySnapshot;
  settings: PiChatSettings | null; read: ReadPolicy; provider: 'local' | 'openai'; model: string;
  diagnostics?: PiDiagnostics; runtimeState?: PiDiagnosticSnapshot['state'];
  stopping: boolean; runStartedAt?: number; latestInput?: SubmissionRecord;
  recentlyForgotten?: ConversationId; forgetting?: boolean;
  editReviews?: EditReview[];
  editOutcomes?: Readonly<Record<string, CommittedEdit>>;
};
export function canForgetConversation(value: PiViewSnapshot): boolean {
  const live = viewLive(value.view);
  return Boolean(value.conversation && value.initialized && value.runtimeState === 'open' && !value.loading && !value.forgetting
    && !live.run && !live.compactions?.length && !viewInbox(value.view).items.length);
}
type AuthorityChange = { retiredAuthorityIds: string[]; noteId?: string; excluded?: boolean; writePolicyChanged?: boolean };
type Dependencies = { open?: () => Promise<PiChat>; settings?: () => Promise<PiChatSettings>; lastConversation?: () => Promise<string | null>; changeRead?: typeof setReadPolicy; observeAuthority?: (receive: (change: AuthorityChange) => void) => Promise<() => void> };

/** Disposable selection and loaded pages. Every execution/queue outcome stays in Pi. */
export function createPiConversationView(deps: Dependencies = {}) {
  const state = writable<PiViewSnapshot>({ initialized: false, loading: false, error: null, conversation: null, title: '', view: null, entries: [], conversations: [], settings: null,
    read: { mode: 'fullVault', attachedNoteIds: [] }, provider: 'local', model: '', stopping: false });
  let chat: PiChat | undefined;
  let opening: Promise<void> | undefined;
  let lifetime = 0;
  let disposed = false;
  let observation: ReturnType<typeof withCancel> | undefined;
  let unsubscribe: (() => void) | undefined;
  let stopDiagnostics: (() => void) | undefined;
  let stopAuthority: (() => void) | undefined;
  const listObservation = withCancel(PI_CONTEXT);
  type ListChange = { chat?: Readonly<ReturnType<typeof ChatDoc.definition.initial>> | null; agent?: Readonly<AgentState> | null };
  // Only revisions arriving during a read are retained; the loaded rows remain the sole list projection.
  let listReadChanges: Map<ConversationId, ListChange> | undefined;
  let listWork = Promise.resolve();
  let listLoaded = false;
  const pendingRows = new Set<ConversationId>();
  let replacement: { authorityId: string; pending: Promise<void> } | undefined;
  const snapshot = () => get(state);
  const unavailable = 'Chat is unavailable. Restart the app to reconnect.';
  const report = (error: unknown) => { if (!disposed) state.update(value => ({ ...value, error: value.runtimeState && value.runtimeState !== 'open' ? unavailable : chatErrorMessage(error) })); };
  const observationUnavailable = 'Chat updates are unavailable. Restart the app to reconnect.';
  const reportObservationError = (error: unknown) => {
    if (disposed) return;
    chat?.diagnostics.report(error);
    state.update(value => ({ ...value, error: value.runtimeState && value.runtimeState !== 'open' ? unavailable : observationUnavailable }));
  };
  const requireOpen = () => { if (snapshot().runtimeState !== 'open') throw new Error(unavailable); };
  const adoptAuthority = (id: ConversationId, authority: AuthoritySnapshot) => {
    if (disposed) return;
    state.update(value => value.conversation?.id !== id || (value.authority && value.authority.revision > authority.revision)
      ? value : { ...value, authority, read: authority.read });
  };
  async function initialize(id?: string | null) {
    if (disposed) return;
    if (!opening) opening = (async () => {
      const selection = lifetime;
      state.update(value => ({ ...value, loading: true }));
      const [runtime, settings] = await Promise.all([(deps.open ?? openPiChat)(), (deps.settings ?? readPiChatSettings)()]);
      if (disposed) return;
      chat = runtime;
      state.update(value => ({ ...value, initialized: true, diagnostics: runtime.diagnostics, settings, read: defaultReadPolicy(settings), provider: settings.provider,
        model: settings.provider === 'local' ? settings.localModel : settings.openaiModel }));
      stopDiagnostics = runtime.diagnostics.subscribe(value => { if (!disposed) state.update(current => ({ ...current, runtimeState: value.state })); });
      unsubscribe = runtime.harness.subscribeCommits(publication => {
        for (const change of publication.changes) if (change.type === 'submission' && change.value.type === 'input') {
          const input = change.value;
          state.update(value => input.conversationId === value.conversation?.id && (!value.latestInput || input.id >= value.latestInput.id) ? { ...value, latestInput: input } : value);
        }
        updateList(publication);
        for (const change of publication.changes) if (change.type === 'task' && change.value.conversationId === snapshot().conversation?.id && change.value.owner) {
          const result = committedPublicationResult(change.value);
          if (result) state.update(value => ({ ...value, editOutcomes: { ...value.editOutcomes, [change.value.owner!]: result } }));
        }
      });
      const observe = deps.observeAuthority ?? (receive => listen<AuthorityChange>('pi-chat-authority-changed', event => receive(event.payload)));
      // Native retirement has already happened. This listener only replaces the visible context.
      void observe(change => {
        const current = snapshot();
        if (change.writePolicyChanged && current.conversation && chat) {
          const id = current.conversation.id;
          void chat.authorityForConversation(id).then(authority => {
            if (authority) adoptAuthority(id, authority);
          }).catch(report);
        }
        if (!change.excluded || !change.noteId || !current.authority || !change.retiredAuthorityIds.includes(current.authority.authorityId)) return;
        const read = { ...current.read, attachedNoteIds: change.excluded && change.noteId ? current.read.attachedNoteIds.filter(id => id !== change.noteId) : [...current.read.attachedNoteIds] };
        void replaceRetired(current, read).catch(report);
      }).then(stop => { if (disposed) stop(); else stopAuthority = stop; }).catch(report);
      // List reads report their own safe failure; initialization must not attach duplicate subscriptions on retry.
      await refreshList().catch(() => {});
      if (!id) {
        // The workspace already persists the last viewed conversation in vault state.
        // Restore only on first open; New chat and later initialize() calls stay fresh.
        const remembered = await (deps.lastConversation ?? (async () =>
          (await invoke<{ conversationId: string } | null>('get_last_chat_location'))?.conversationId ?? null))().catch(() => null);
        if (remembered && /^\d+$/.test(remembered) && !disposed && selection === lifetime) {
          const doc = await runtime.harness.snapshot(ChatDoc, Number(remembered) as ConversationId, listObservation.context).catch(reportObservationError);
          if (doc && !doc.forgotten && !disposed && selection === lifetime) await select(remembered);
        }
      }
      if (!id && !disposed && selection === lifetime) state.update(value => ({ ...value, loading: false }));
    })().catch(() => { opening = undefined; if (disposed) return; state.update(value => ({ ...value, loading: false, error: observationUnavailable })); });
    await opening;
    if (id && !disposed && String(snapshot().conversation?.id) !== id) await select(id);
  }
  function changedRow(row: PiConversationSummary, change?: ListChange): PiConversationSummary | undefined {
    if (change?.chat === null) return;
    let result = change?.chat ? { ...row, ...change.chat } : row;
    if (result.forgotten) return;
    if (change && 'agent' in change) {
      const { model: _previous, ...rest } = result;
      result = { ...rest, ...(change.agent?.model ? { model: change.agent.model } : {}) };
    }
    return result;
  }
  function mergeList(rows: PiConversationSummary[], changes?: Map<ConversationId, ListChange>) {
    state.update(value => {
      const merged = new Map(value.conversations.map(row => [row.id, row]));
      for (const row of rows) {
        const current = changedRow(row, changes?.get(row.id));
        if (current) merged.set(row.id, current); else merged.delete(row.id);
      }
      return { ...value, conversations: [...merged.values()].sort((a, b) => b.id - a.id) };
    });
  }
  function enqueueList(read: (changes: Map<ConversationId, ListChange>) => Promise<void>) {
    const pending = listWork.then(async () => {
      if (!chat || disposed || listObservation.context.abortSignal?.aborted) return;
      const changes = listReadChanges = new Map<ConversationId, ListChange>();
      try { await read(changes); }
      catch (error) {
        if (!listObservation.context.abortSignal?.aborted) { reportObservationError(error); throw new Error(observationUnavailable); }
      }
      finally { listReadChanges = undefined; }
    });
    listWork = pending.catch(() => {});
    return pending;
  }
  function hydrateListRow(id: ConversationId) {
    if (pendingRows.has(id)) return;
    pendingRows.add(id);
    void enqueueList(async changes => {
      try {
        const context = listObservation.context;
        const doc = await chat!.harness.snapshot(ChatDoc, id, context);
        const agent = await chat!.harness.snapshot(AgentDoc, id, context);
        const patch = changes.get(id);
        const currentDoc = patch && 'chat' in patch ? patch.chat : doc;
        if (!disposed && !context.abortSignal?.aborted && currentDoc) mergeList([{ id, ...currentDoc, ...(agent?.model ? { model: agent.model } : {}) }], changes);
      } finally { pendingRows.delete(id); }
    }).catch(report);
  }
  function updateList(publication: CommitPublication) {
    if (disposed) return;
    const changes = new Map<ConversationId, ListChange>();
    const hydrate = new Set<ConversationId>();
    for (const change of publication.changes) {
      if (change.type === 'conversation') { hydrate.add(change.value.id); continue; }
      if ((change.type !== 'document' && change.type !== 'document.copy') || change.conversationId === undefined) continue;
      const id = change.conversationId;
      if (change.record.kind !== ChatDoc.definition.kind && change.record.kind !== AgentDoc.definition.kind) continue;
      if (change.type === 'document.copy') {
        if (snapshot().conversations.some(row => row.id === id)) hydrate.add(id);
        continue;
      }
      const patch = changes.get(id) ?? {};
      if (change.record.kind === ChatDoc.definition.kind) {
        patch.chat = change.value as ListChange['chat'];
        // A newly attached app document may follow conversation creation in another commit.
        if (change.value && !(change.value as ListChange['chat'])?.forgotten && !snapshot().conversations.some(row => row.id === id)) hydrate.add(id);
      } else patch.agent = change.value as ListChange['agent'];
      changes.set(id, patch);
    }
    if (!changes.size && !hydrate.size) return;
    for (const [id, patch] of changes) if (listReadChanges) listReadChanges.set(id, { ...listReadChanges.get(id), ...patch });
    state.update(value => ({ ...value, conversations: value.conversations.flatMap(row => {
      const next = changedRow(row, changes.get(row.id)); return next ? [next] : [];
    }) }));
    for (const id of hydrate) hydrateListRow(id);
  }
  function refreshList(more = false) {
    return enqueueList(async changes => {
      if (more && listLoaded && !snapshot().listNext) return;
      const page = await chat!.listConversations(50, more ? snapshot().listNext : undefined, listObservation.context);
      if (disposed || listObservation.context.abortSignal?.aborted) return;
      mergeList(page.items, changes);
      state.update(value => ({ ...value, listNext: more || !listLoaded ? page.next : value.listNext }));
      listLoaded = true;
    });
  }
  async function select(id: string | null) {
    if (disposed) return;
    const token = ++lifetime;
    observation?.cancel();
    const scope = observation = withCancel(PI_CONTEXT);
    const context = scope.context;
    state.update(value => ({ ...value, loading: Boolean(id), conversation: null, view: null, entries: [], editReviews: [], editOutcomes: {}, historyNext: undefined, authority: undefined, title: '', error: null, runStartedAt: undefined, stopping: false, latestInput: undefined }));
    if (!id || !chat) {
      try {
        const settings = chat ? await (deps.settings ?? readPiChatSettings)() : snapshot().settings;
        if (settings && token === lifetime && !disposed) state.update(value => ({ ...value, settings, read: defaultReadPolicy(settings), provider: settings.provider, model: settings.provider === 'local' ? settings.localModel : settings.openaiModel }));
      } catch (error) { if (token === lifetime) report(error); }
      return;
    }
    try {
      requireOpen();
      if (!/^\d+$/.test(id)) throw new Error('This conversation is unavailable.');
      const conversation = await chat.harness.conversation(Number(id) as ConversationId, context);
      if (context.abortSignal?.aborted) return;
      if (!conversation) throw new Error('This conversation is unavailable.');
      const titleWatch = await chat.harness.watchDoc(ChatDoc, conversation.id, context);
      if (context.abortSignal?.aborted) return;
      const doc = titleWatch?.value;
      if (!doc) throw new Error('This conversation is unavailable.');
      if (doc.forgotten) throw new Error('This conversation was forgotten.');
      let authority = await chat.authorityForConversation(conversation.id);
      if (context.abortSignal?.aborted) return;
      if (!authority && !doc.retired) { requireOpen(); authority = await chat.bindConversation(conversation); }
      if (context.abortSignal?.aborted) return;
      const [watch, reviewWatch, page] = await Promise.all([
        conversation.watch(context),
        chat.harness.watchDoc(EditReviewDoc, conversation.id, context),
        conversation.entries({}, 50, undefined, context)
      ]);
      if (context.abortSignal?.aborted) return;
      state.update(value => ({ ...value, loading: false, conversation, authority, title: doc.title,
        read: authority?.read ?? value.read,
        entries: mergeEntries(page.items, watch.value.entries), historyNext: page.next }));
      // Task-scoped working documents retire at settlement. Terminal tasks retain
      // their owner/result, so reopening reads proof directly rather than keeping a second ledger.
      let taskCursor: Cursor | undefined;
      do {
        const tasks = await chat.storage.scanTasks({ conversationId: conversation.id, kind: PublicationTask.definition.name, status: 'terminal' }, 128, taskCursor, context);
        if (context.abortSignal?.aborted || disposed || token !== lifetime) return;
        const outcomes: Record<string, CommittedEdit> = {};
        for (const task of tasks.items) {
          const result = committedPublicationResult(task);
          if (task.owner && result) outcomes[task.owner] = result;
        }
        state.update(value => ({ ...value, editOutcomes: { ...outcomes, ...value.editOutcomes } }));
        taskCursor = tasks.next;
      } while (taskCursor);
      // Terminal input can lack an assistant entry (for example a task fault).
      // Read the latest input once; later immutable submission commits keep it current.
      void (async () => {
        let cursor: Cursor | undefined;
        do {
          const page = await chat!.storage.scanSubmissions({ conversationId: conversation.id, order: 'descending' }, 50, cursor, context);
          const input = page.items.find(item => item.type === 'input');
          if (input) {
            if (!context.abortSignal?.aborted && !disposed && token === lifetime) state.update(value => !value.latestInput || input.id > value.latestInput.id ? { ...value, latestInput: input } : value);
            return;
          }
          cursor = page.next;
        } while (cursor && !disposed && token === lifetime);
      })().catch(error => { if (!context.abortSignal?.aborted && token === lifetime) reportObservationError(error); });
      const apply = async (view: ConversationView, ops: readonly Op[]) => {
        if (context.abortSignal?.aborted || disposed || token !== lifetime) return;
        const run = viewLive(view).run;
        const agent = view.docs[AgentDoc.definition.kind] as AgentState | undefined;
        // Pi coalesces a slow observer's backlog into a full replacement frame.
        const entriesChanged = ops.some(op => op[0] === 'r' || op[1][0] === 'entries');
        state.update(value => ({ ...value, view, entries: entriesChanged ? mergeEntries(value.entries, view.entries) : value.entries,
          provider: agent?.model?.provider === 'openai' ? 'openai' : 'local', model: agent?.model?.modelId ?? value.model,
          runStartedAt: run ? value.runStartedAt : undefined }));
        if (run && !snapshot().runStartedAt) {
          try {
            const task = await chat!.harness.getTask(run.taskId, context);
            if (!context.abortSignal?.aborted && !disposed && token === lifetime && viewLive(snapshot().view).run?.taskId === run.taskId)
              state.update(value => ({ ...value, runStartedAt: task?.startedAt ?? Date.now() }));
          } catch (error) { if (!context.abortSignal?.aborted) throw error; }
        }
      };
      await apply(watch.value, []);
      if (disposed || token !== lifetime) return;
      watch.start(apply);
      const watchEnded = (end: WatchEnd) => {
        if (context.abortSignal?.aborted || token !== lifetime || disposed || (end.reason !== 'session_failed' && end.reason !== 'listener_error')) return;
        chat!.diagnostics.reportWatchFailure(end, conversation.id);
        state.update(value => ({ ...value, error: 'Conversation updates stopped. Restart the app to reconnect.' }));
        scope.cancel();
      };
      void watch.closed.then(watchEnded);
      if (reviewWatch) {
        const applyReviews = (value: Readonly<{ items: Record<string, EditReview> }> | null) => {
          if (!context.abortSignal?.aborted && token === lifetime && !disposed)
            state.update(current => ({ ...current, editReviews: Object.values(value?.items ?? {}) }));
        };
        applyReviews(reviewWatch.value);
        reviewWatch.start(async value => applyReviews(value));
        void reviewWatch.closed.then(watchEnded);
      }
      if (titleWatch) {
        void titleWatch.closed.then(watchEnded);
        titleWatch.start(async value => {
          if (!value || context.abortSignal?.aborted || token !== lifetime || disposed) return;
          if (value.forgotten) { await select(null); return; }
          state.update(current => ({ ...current, title: value.title }));
          if (value.retired) {
            const authority = await chat!.authorityForConversation(conversation.id);
            if (!context.abortSignal?.aborted && token === lifetime && !disposed) state.update(current => ({ ...current, authority }));
          }
        });
      }
    } catch (error) {
      if (!context.abortSignal?.aborted && token === lifetime && !disposed) {
        state.update(value => ({ ...value, loading: false }));
        reportObservationError(error);
      }
      // Pi releases successful watches and any still attaching when a sibling read fails.
      scope.cancel();
    }
  }
  async function send(text: string) {
    if (!text.trim()) return;
    const selection = lifetime;
    await initialize();
    if (disposed || selection !== lifetime) throw new Error('The draft changed before sending. Its text has been kept.');
    if (!chat) throw new Error(snapshot().error ?? 'Chat is unavailable.');
    requireOpen();
    let current = snapshot();
    let conversation = current.conversation;
    if (!conversation) {
      const token = lifetime;
      conversation = await chat.createConversation({ firstMessage: text, provider: current.provider, model: current.model, read: current.read });
      if (disposed || lifetime !== token) throw new Error('The draft changed before sending. Its text has been kept.');
      await select(String(conversation.id));
      state.update(value => ({ ...value, recentlyForgotten: undefined }));
      current = snapshot();
    }
    const token = lifetime;
    const authority = await chat.authorityForConversation(conversation.id);
    if (disposed || token !== lifetime) throw new Error('The draft changed before sending. Its text has been kept.');
    if (!authority) throw new Error('Conversation access is unavailable. Start a new conversation.');
    if (authority.retired) throw new Error('This conversation has retired access. Start a new conversation.');
    requireOpen();
    // Text contains only explicit user input. Notes are read by authorized tools.
    return conversation.submit({ type: 'input', content: text, whenBusy: 'followUp' }, PI_CONTEXT);
  }
  async function stop() {
    const conversation = snapshot().conversation;
    if (!conversation) return;
    state.update(value => ({ ...value, stopping: true }));
    try { await conversation.abort(PI_CONTEXT, { background: true }); }
    catch (error) { report(error); }
    finally { if (snapshot().conversation?.id === conversation.id) state.update(value => ({ ...value, stopping: false })); }
  }
  async function changeRead(read: ReadPolicy) {
    requireOpen();
    const current = snapshot();
    if (!current.conversation || !current.authority || !chat) { state.update(value => ({ ...value, read })); return; }
    const authority = await (deps.changeRead ?? setReadPolicy)(current.authority.authorityId, current.authority.revision, read);
    if (authority.retired) {
      await replaceRetired(current, read);
    } else adoptAuthority(current.conversation.id, authority);
  }
  async function changeWrite(write: WritePolicy) {
    requireOpen();
    let current = snapshot();
    if (!current.conversation) {
      if (!chat) throw new Error('Chat is unavailable.');
      const changed = 'The chat changed before editing permission could be updated. Choose permission again in the current chat.';
      const origin = lifetime;
      const conversation = await chat.createConversation({ provider: current.provider, model: current.model, read: current.read });
      if (disposed || origin !== lifetime) throw new Error(changed);
      const selecting = select(String(conversation.id));
      const selection = lifetime;
      await selecting;
      if (disposed || selection !== lifetime || snapshot().conversation?.id !== conversation.id) throw new Error(changed);
      current = snapshot();
    }
    if (!current.authority || !current.conversation) throw new Error('Conversation access is unavailable.');
    // Temporary grants bind to the actual Pi conversation, including first use.
    if (write.grant.duration === 'temporary') write = { ...write, grant: { ...write.grant, conversationId: current.conversation.id } };
    const authority = await setWritePolicy(current.authority.authorityId, current.authority.revision, write);
    adoptAuthority(current.conversation.id, authority);
  }
  async function reviewEdit(taskId: number, decision: 'approved' | 'rejected') {
    requireOpen();
    const conversation = snapshot().conversation;
    if (!chat || !conversation) throw new Error('Conversation is unavailable.');
    await decideEditReview(chat.harness, conversation.id, taskId, decision);
  }
  async function replaceRetired(current: PiViewSnapshot, read: ReadPolicy) {
    if (!current.conversation || !chat) return;
    const authorityId = current.authority?.authorityId ?? '';
    if (replacement?.authorityId === authorityId) return replacement.pending;
    const pending = (async () => {
      await chat!.retireConversation(current.conversation!.id);
      const fresh = await chat!.createConversation({ provider: current.provider, model: current.model, read });
      if (!disposed && snapshot().conversation?.id === current.conversation!.id) await select(String(fresh.id));
    })();
    replacement = { authorityId, pending };
    try { await pending; } finally { if (replacement?.pending === pending) replacement = undefined; }
  }
  async function configure(provider: 'local' | 'openai', model: string) {
    requireOpen();
    const current = snapshot();
    if (viewLive(current.view).run) throw new Error('Wait for this response to finish before changing models.');
    if (!model.trim()) throw new Error('Choose a configured model.');
    if (current.conversation && chat) {
      await chat.models.registerModel(provider, model);
      requireOpen();
      await current.conversation.configure({ model: { provider, modelId: model } }, PI_CONTEXT);
    }
    if (snapshot().conversation?.id === current.conversation?.id) state.update(value => ({ ...value, provider, model }));
  }
  return {
    subscribe: state.subscribe, getSnapshot: snapshot, initialize, select, refreshList, send, stop, changeRead, changeWrite, reviewEdit, configure,
    async startNew() { state.update(value => ({ ...value, recentlyForgotten: undefined })); await select(null); },
    async forget() {
      requireOpen();
      const current = snapshot();
      if (!current.conversation || !chat) return;
      if (!canForgetConversation(current)) throw new Error('Stop the response before forgetting this chat.');
      const id = current.conversation.id;
      state.update(value => ({ ...value, forgetting: true }));
      try {
        // Reversible presentation metadata only. Pi history and native authority keep their owners.
        await chat.harness.commit(async tx => {
          const live = await tx.doc(LiveDoc, id), inbox = await tx.doc(InboxDoc, id);
          if (live.run || live.compactions?.length || inbox.items.length) throw new Error('Stop the response before forgetting this chat.');
          (await tx.doc(ChatDoc, id)).forgotten = true;
        }, PI_CONTEXT);
        if (!disposed) {
          if (snapshot().conversation?.id === id) await select(null);
          state.update(value => ({ ...value, recentlyForgotten: id }));
        }
      } finally { if (!disposed) state.update(value => ({ ...value, forgetting: false })); }
    },
    async unforget() {
      requireOpen();
      const id = snapshot().recentlyForgotten;
      if (!id || !chat) return;
      await chat.harness.commit(async tx => { (await tx.doc(ChatDoc, id)).forgotten = false; }, PI_CONTEXT);
      if (!disposed) {
        state.update(value => ({ ...value, recentlyForgotten: undefined }));
        await select(String(id));
      }
    },
    clearError: () => state.update(value => ({ ...value, error: null })), report,
    async loadOlder() {
      requireOpen();
      const current = snapshot(), token = lifetime, context = observation?.context;
      if (!current.conversation || !current.historyNext || !context) return;
      try {
        const page = await current.conversation.entries({}, 50, current.historyNext, context);
        if (!disposed && token === lifetime && !context.abortSignal?.aborted) state.update(value => ({ ...value, entries: mergeEntries(page.items, value.entries), historyNext: page.next }));
      } catch (error) { if (!context.abortSignal?.aborted) { reportObservationError(error); throw new Error(observationUnavailable); } }
    },
    async withdraw(id: SubmissionId) {
      requireOpen();
      if (!chat || !snapshot().conversation) return;
      const result = await chat.harness.abortSubmission(id, PI_CONTEXT, snapshot().conversation!.id);
      if (result === 'already_placed') throw new Error('This message has started. Use Stop to cancel the response.');
    },
    async rename(title: string) {
      requireOpen();
      const conversation = snapshot().conversation;
      if (!conversation || !title.trim()) return;
      await conversation.commit(async tx => { (await tx.doc(ChatDoc, conversation.id)).title = title.trim(); }, PI_CONTEXT);
    },
    async newAttempt() {
      requireOpen();
      const current = snapshot(), token = lifetime, context = observation?.context;
      let entry = current.latestInput?.entry ? current.entries.find(entry => entry.id === current.latestInput!.entry) : [...current.entries].reverse().find(UserEntry.is);
      if (!entry && current.latestInput?.entry && current.conversation && context) {
        try { entry = (await current.conversation.entries({ minEntryId: current.latestInput.entry, maxEntryId: current.latestInput.entry }, 1, undefined, context)).items[0]; }
        catch (error) { if (context.abortSignal?.aborted) return; reportObservationError(error); throw new Error(observationUnavailable); }
      }
      if (disposed || token !== lifetime) return;
      const user = entry && UserEntry.is(entry) ? entry.model?.find(message => message.role === 'user') : undefined;
      if (user) return send(messageText(user));
    },
    dispose() { disposed = true; ++lifetime; observation?.cancel(); listObservation.cancel(); unsubscribe?.(); stopDiagnostics?.(); stopAuthority?.(); }
  };
}
export type PiConversationBinding = ReturnType<typeof createPiConversationView>;
export function latestFailure(entries: readonly EntryRecord[]): AssistantMessage | undefined {
  const assistant = entries.flatMap(entry => entry.model ?? []).filter((message): message is AssistantMessage => message.role === 'assistant').at(-1);
  return assistant && (assistant.stopReason === 'error' || assistant.stopReason === 'aborted') ? assistant : undefined;
}

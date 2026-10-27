import { get, readable, writable, type Readable } from 'svelte/store';
import { withCancel, BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { InboxDoc, LiveDoc, type ConversationId, type Cursor, type EntryRecord, type Harness, type InboxState, type LiveState, type Storage, type SubmissionRecord } from '@earendil-works/pi-durable';
import { ChatDoc, ChatReadDoc } from './documents';
import { openPiChat, type PiChat } from './runtime';

export type ChatActivityStatus = 'running' | 'unread' | null;
type CompletedInput = SubmissionRecord & { type: 'input'; status: 'done' | 'unanswered' };
export type ConversationActivity = Readonly<{ running: boolean; unread: boolean; completed: number; completion?: CompletedInput }>;
export type ChatActivitySnapshot = Readonly<{ conversations: ReadonlyMap<ConversationId, ConversationActivity>; status: ChatActivityStatus }>;
export const emptyChatActivity: Readable<ChatActivitySnapshot> = readable({ conversations: new Map(), status: null });
export function activityStatus(items: Iterable<ConversationActivity>): ChatActivityStatus {
  let running = false;
  for (const item of items) { if (item.unread) return 'unread'; running ||= item.running; }
  return running ? 'running' : null;
}
export function activityDescription(status: ChatActivityStatus) {
  return status === 'running' ? 'Chats running' : status === 'unread' ? 'Finished chats with unread results' : undefined;
}
type Row = { chat?: Readonly<ReturnType<typeof ChatDoc.definition.initial>> | null; run: boolean; queued: boolean; completion?: CompletedInput; read: number };
const isCompletion = (input: SubmissionRecord): input is CompletedInput => input.type === 'input' &&
  (input.status === 'done' || input.status === 'unanswered' && input.entry !== undefined && input.reason !== 'aborted');

/** A newer input cannot establish that an older, possibly compacted result was viewed. */
export function isCompletionDisplayed(completion: CompletedInput | undefined, latestInput: SubmissionRecord | undefined, entries: readonly Pick<EntryRecord, 'id'>[]) {
  if (!completion) return false;
  if (completion.status === 'done') return entries.some(entry => entry.id === completion.answer);
  return latestInput?.id === completion.id && entries.some(entry => entry.id === completion.entry);
}

/** Vault-lifetime presentation projection, independent of mounted chat views. */
export function createChatActivity(harness: Harness, storage: Storage, report: (error: unknown) => void) {
  const scope = withCancel(BACKGROUND_CONTEXT), context = scope.context;
  const state = writable<ChatActivitySnapshot>({ conversations: new Map(), status: null });
  const rows = new Map<ConversationId, Row>();
  const hydrating = new Map<ConversationId, Promise<void>>(), hydrated = new Set<ConversationId>();
  const patches = new Map<ConversationId, Partial<Row>>();
  let disposed = false, dirty = false;
  function publish() {
    if (disposed || !dirty) return;
    dirty = false;
    const conversations = new Map<ConversationId, ConversationActivity>();
    for (const [id, row] of rows) {
      if (!row.chat || row.chat.forgotten || row.chat.purpose === 'noteTitles') continue;
      const completed = row.completion?.id ?? 0;
      conversations.set(id, { running: row.run || row.queued, unread: completed > row.read, completed, completion: row.completion });
    }
    // Streaming partials do not change activity. Avoid republishing the entire UI for every token.
    const previous = get(state).conversations;
    if (previous.size === conversations.size && [...conversations].every(([id, item]) => {
      const old = previous.get(id); return old?.running === item.running && old?.unread === item.unread && old?.completed === item.completed;
    })) return;
    state.set({ conversations, status: activityStatus(conversations.values()) });
  }
  function patch(id: ConversationId, value: Partial<Row>) {
    const old = rows.get(id);
    if (!old || Object.entries(value).some(([key, field]) => old[key as keyof Row] !== field)) dirty = true;
    rows.set(id, { run: false, queued: false, read: 0, ...rows.get(id), ...value });
    if (!hydrated.has(id)) patches.set(id, { ...patches.get(id), ...value });
  }
  function hydrate(id: ConversationId): Promise<void> {
    if (hydrated.has(id) || disposed) return Promise.resolve();
    const pending = hydrating.get(id); if (pending) return pending;
    // Commit listeners must not call Session APIs. Defer acquisition until after publication.
    const work = Promise.resolve().then(async () => {
      if (disposed) return;
      const [chat, live, inbox, read] = await Promise.all([
        harness.snapshot(ChatDoc, id, context), harness.snapshot(LiveDoc, id, context),
        harness.snapshot(InboxDoc, id, context), harness.snapshot(ChatReadDoc, id, context)
      ]);
      let completion: CompletedInput | undefined, cursor: Cursor | undefined;
      if (chat && chat.purpose !== 'noteTitles') do {
        const page = await storage.scanSubmissions({ conversationId: id, order: 'descending' }, 50, cursor, context);
        const terminal = page.items.find(isCompletion);
        if (terminal) { completion = terminal; break; }
        cursor = page.next;
      } while (cursor && !disposed);
      if (disposed) return;
      const completed = completion?.id ?? 0;
      rows.set(id, { chat, run: Boolean(live?.run || live?.compactions?.length), queued: Boolean(inbox?.items.length),
        completion, read: read?.initialized ? read.throughSubmissionId : completed, ...patches.get(id) });
      patches.delete(id); hydrated.add(id); dirty = true; publish();
      // Existing installations start with their old history read. New chats have a cursor from creation.
      if (chat && chat.purpose !== 'noteTitles' && !read?.initialized) await harness.commit(async tx => {
        const marker = await tx.doc(ChatReadDoc, id);
        if (!marker.initialized) { marker.initialized = true; marker.throughSubmissionId = completed; }
      }, context);
    }).catch(error => { if (!disposed) report(error); }).finally(() => hydrating.delete(id));
    hydrating.set(id, work); return work;
  }
  const stop = harness.subscribeCommits(publication => {
    if (disposed) return;
    for (const change of publication.changes) {
      if (change.type === 'conversation') { void hydrate(change.value.id); continue; }
      if (change.type === 'submission' && isCompletion(change.value)) {
        const input = change.value, current = rows.get(input.conversationId)?.completion;
        if (!current || input.id > current.id) patch(input.conversationId, { completion: input });
        void hydrate(input.conversationId);
      }
      if (change.type !== 'document' || change.conversationId === undefined) continue;
      const id = change.conversationId;
      switch (change.record.kind) {
        case ChatDoc.definition.kind: patch(id, { chat: change.value as Row['chat'] }); break;
        case LiveDoc.definition.kind: {
          const live = change.value as LiveState | null;
          patch(id, { run: Boolean(live?.run || live?.compactions?.length) }); break;
        }
        case InboxDoc.definition.kind: patch(id, { queued: Boolean((change.value as InboxState | null)?.items.length) }); break;
        case ChatReadDoc.definition.kind: patch(id, { read: (change.value as ReturnType<typeof ChatReadDoc.definition.initial> | null)?.throughSubmissionId ?? 0 }); break;
        default: continue;
      }
      void hydrate(id);
    }
    publish();
  });
  const ready = (async () => {
    let cursor: Cursor | undefined;
    do {
      const page = await storage.scanConversations({}, 128, cursor, context);
      await Promise.all(page.items.map(row => hydrate(row.id)));
      cursor = page.next;
    } while (cursor && !disposed);
  })().catch(error => { if (!disposed) report(error); });
  const dispose = () => { if (disposed) return; disposed = true; stop(); scope.cancel(); state.set({ conversations: new Map(), status: null }); };
  void harness.closed.then(dispose);
  return {
    subscribe: state.subscribe, ready, dispose,
    async markRead(id: ConversationId, throughSubmissionId: number) {
      if (disposed || throughSubmissionId <= (rows.get(id)?.read ?? 0)) return;
      await harness.commit(async tx => {
        const marker = await tx.doc(ChatReadDoc, id);
        marker.initialized = true;
        marker.throughSubmissionId = Math.max(marker.throughSubmissionId, throughSubmissionId);
      }, context);
    }
  };
}
export type ChatActivity = ReturnType<typeof createChatActivity>;
const activities = new WeakMap<Harness, ChatActivity>();
export function getChatActivity(chat: Pick<PiChat, 'harness' | 'diagnostics'> & { storage: Storage }): ChatActivity {
  let activity = activities.get(chat.harness);
  if (!activity) { activity = createChatActivity(chat.harness, chat.storage, chat.diagnostics.report); activities.set(chat.harness, activity); }
  return activity;
}

const currentActivity = writable<ChatActivity | undefined>(undefined);
/** Composition publishes successful runtime opens, including an explicit retry. */
export function bindChatActivity(activity: ChatActivity) {
  if (get(currentActivity) !== activity) currentActivity.set(activity);
}

/** Buttons can observe the shared runtime before any chat pane has been opened. */
export const chatActivity = readable<ChatActivitySnapshot>({ conversations: new Map(), status: null }, set => {
  if (typeof window === 'undefined') return;
  let stop: (() => void) | undefined;
  const stopCurrent = currentActivity.subscribe(activity => {
    stop?.();
    stop = activity?.subscribe(set);
  });
  void openPiChat().catch(() => {});
  return () => { stopCurrent(); stop?.(); };
});

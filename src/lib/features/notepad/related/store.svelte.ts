import { SvelteMap } from 'svelte/reactivity';
import { getRelatedNotes, getNoteBacklinks } from '../search/search';
import type { DocumentBody } from '../document/documentBody';
import type { RelatedNoteItem, RelatedNotesResponse } from '#lib/types/semantic.js';

export type RelatedView = 'related' | 'backlinks';
const entryKey = (handle: string, view: RelatedView) => `${handle}:${view}`;

export interface RelatedContext {
  documentHandle: string;
  currentPath: string | null;
  currentTitle: string;
  body: DocumentBody;
}
const sameInput = (left: RelatedContext, right: RelatedContext) =>
  left.currentPath === right.currentPath && left.currentTitle === right.currentTitle &&
  left.body === right.body;

export class RelatedResult {
  items = $state<RelatedNoteItem[]>([]);
  status = $state<RelatedNotesResponse['status']>('insufficientContent');
  reason = $state<string | null>(null);
  isLoading = $state(false);
  isStale = $state(false);
  consumers = 0;
  epoch = 0;
  context: RelatedContext;
  pending: Promise<void> | null = null;
  constructor(context: RelatedContext, readonly view: RelatedView = 'related') { this.context = { ...context }; }
}

/** Related data only. Popup presentation stays local to the command bar; subscribers
 * share retrieval by the open document's immutable lifetime handle. */
export class RelatedNotesStore {
  #entries = new SvelteMap<string, RelatedResult>();
  #disposed = false;

  update(context: RelatedContext) {
    for (const entry of this.#entries.values()) {
      if (entry.context.documentHandle !== context.documentHandle || sameInput(entry.context, context)) continue;
      entry.context = { ...context };
      this.#invalidate(entry);
    }
  }

  acquire(context: RelatedContext, view: RelatedView = 'related') {
    const key = entryKey(context.documentHandle, view);
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = new RelatedResult(context, view);
      this.#entries.set(key, entry);
    } else this.update(context);
    const first = entry.consumers++ === 0;
    if (first) void this.refresh(entry);
    let released = false;
    return { result: entry, release: () => {
      if (released) return;
      released = true;
      if (--entry.consumers === 0) {
        entry.epoch++;
        entry.isLoading = false;
        entry.pending = null;
        // No hidden cache can keep retired document lifetimes alive.
        this.#entries.delete(key);
      }
    } };
  }

  #invalidate(entry: RelatedResult) {
    entry.epoch++;
    entry.isStale = true;
    entry.isLoading = false;
    entry.pending = null;
  }

  /** Existing document/vault notifications invalidate, never reorder an open list. */
  scheduleRelated = (_options?: { immediate?: boolean }) => {
    for (const entry of this.#entries.values()) this.#invalidate(entry);
  };

  invalidateTarget = (notePath: string) => {
    for (const entry of this.#entries.values()) {
      entry.items = entry.items.filter(item => item.notePath !== notePath);
      this.#invalidate(entry);
    }
  };

  refresh = (entry: RelatedResult): Promise<void> => {
    if (entry.pending) return entry.pending;
    if (this.#disposed || entry.consumers === 0) return Promise.resolve();
    const context = { ...entry.context };
    const epoch = ++entry.epoch;
    entry.isLoading = true;
    const current = () => !this.#disposed && entry.consumers > 0 && entry.epoch === epoch;
    const request = (async () => {
      try {
        const response: RelatedNotesResponse = entry.view === 'backlinks'
          ? { status: 'ready', scope: 'note', reason: context.currentPath ? 'No notes link to this note yet.' : 'Save this note to see backlinks.',
              items: await (context.currentPath ? getNoteBacklinks(context.currentPath) : Promise.resolve([])) }
          : await getRelatedNotes({ currentPath: context.currentPath, currentTitle: context.currentTitle,
              currentMarkdown: context.body.toMarkdown() }, null, 4);
        if (!current()) return;
        if (response.status !== 'unavailable') entry.items = response.items;
        entry.status = response.status;
        entry.reason = response.reason;
        if (response.status !== 'unavailable') entry.isStale = false;
      } catch {
        if (!current()) return;
        entry.status = 'unavailable';
        entry.reason = entry.view === 'backlinks' ? 'Backlinks are unavailable right now.' : 'Related notes are unavailable right now.';
      } finally {
        if (current()) { entry.isLoading = false; entry.pending = null; }
      }
    })();
    entry.pending = request;
    return request;
  };

  dispose = () => {
    this.#disposed = true;
    for (const entry of this.#entries.values()) this.#invalidate(entry);
    this.#entries.clear();
  };
}
export function createRelatedNotesStore() { return new RelatedNotesStore(); }

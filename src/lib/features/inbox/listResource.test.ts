import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxListItem } from '$lib/types/ai';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function inboxItem(id: number, title: string): InboxListItem {
  return {
    id,
    kind: 'remember',
    actionLabel: 'Remember',
    status: 'pendingApproval',
    title,
    summary: '',
    sourcePath: `/vault/${title}.md`,
    sourceTitle: title,
    affectedNotes: [],
    createdAtMillis: id,
    updatedAtMillis: id
  };
}

async function importResource() {
  vi.resetModules();
  return import('./listResource');
}

describe('listResource', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(vi.fn());
  });

  it('keeps stale foreground responses from overwriting newer inbox data', async () => {
    const first = deferred<InboxListItem[]>();
    const second = deferred<InboxListItem[]>();
    invokeMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { refreshInboxList, subscribeInboxListResource } = await importResource();
    const states: boolean[] = [];
    const unsubscribe = subscribeInboxListResource((state) => states.push(state.isLoading));

    const firstRefresh = refreshInboxList();
    const secondRefresh = refreshInboxList();
    second.resolve([inboxItem(2, 'newer')]);
    await secondRefresh;
    first.resolve([inboxItem(1, 'older')]);
    const firstResult = await firstRefresh;

    expect(firstResult).toEqual([inboxItem(2, 'newer')]);
    expect(states.at(-1)).toBe(false);
    unsubscribe();
  });

  it('keeps loading true until all foreground refreshes finish', async () => {
    const first = deferred<InboxListItem[]>();
    const second = deferred<InboxListItem[]>();
    invokeMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { refreshInboxList, subscribeInboxListResource } = await importResource();
    const states: boolean[] = [];
    const unsubscribe = subscribeInboxListResource((state) => states.push(state.isLoading));

    const firstRefresh = refreshInboxList();
    const secondRefresh = refreshInboxList();
    first.resolve([inboxItem(1, 'older')]);
    await firstRefresh;
    expect(states.at(-1)).toBe(true);

    second.resolve([inboxItem(2, 'newer')]);
    await secondRefresh;
    expect(states.at(-1)).toBe(false);
    unsubscribe();
  });
});

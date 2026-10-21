import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskItem } from './taskListStore.svelte';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  invoke: vi.fn(),
  routeTaskDocumentMutation: vi.fn()
}));

vi.mock('#lib/app/appStore.svelte.js', () => ({ appStore: { bootstrap: mocks.bootstrap, subscribeNoteSaved: mocks.subscribe, subscribeVaultNoteChanged: mocks.subscribe, subscribeVaultChanged: mocks.subscribe } }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke
}));
vi.mock('$app/navigation', () => ({
  goto: vi.fn()
}));
vi.mock('./taskMutationGateway', () => ({
  routeTaskDocumentMutation: mocks.routeTaskDocumentMutation
}));

import { TaskListStore } from './taskListStore.svelte';

const task: TaskItem = {
  noteId: 'note-1',
  taskKey: 'note-1::task-1',
  taskId: 'task-1',
  notePath: '/vault/Tasks.md',
  fileName: 'Tasks.md',
  noteTitle: 'Tasks',
  sectionLabel: null,
  text: 'Ship it',
  completed: false,
  hidden: false,
  noteHidden: false,
  noteCollapsed: false,
  depth: 0,
  lineNumber: 3,
  createdAtMillis: 1,
  updatedAtMillis: 1
};

describe('TaskListStore document mutations', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.routeTaskDocumentMutation.mockReset();
  });

  it('refreshes projection after applying a mutation to an open dirty document', async () => {
    mocks.routeTaskDocumentMutation.mockResolvedValue({
      status: 'applied-to-open-document'
    });
    mocks.invoke.mockResolvedValue({
      noteId: task.noteId,
      notePath: task.notePath,
      group: null
    });
    const store = new TaskListStore();

    await store.toggleTask(task);

    expect(mocks.routeTaskDocumentMutation).toHaveBeenCalledWith({
      kind: 'toggle',
      taskId: task.taskId,
      noteId: task.noteId,
      notePath: task.notePath
    });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('get_task_group', {
      noteId: task.noteId,
      filter: 'all',
      showHidden: false
    });
  });

  it('uses the canonical backend command when no dirty open document handles it', async () => {
    mocks.routeTaskDocumentMutation.mockResolvedValue({
      status: 'use-canonical-command'
    });
    mocks.invoke.mockResolvedValue({
      noteId: task.noteId,
      notePath: task.notePath,
      group: null
    });
    const store = new TaskListStore();

    await store.deleteTask(task);

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('delete_task', {
      taskId: task.taskId,
      filter: 'all',
      showHidden: false
    });
  });


});

describe('task-list dates', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.routeTaskDocumentMutation.mockReset(); });
  it('composes deadline filters with the loaded completion/hidden view without reordering notes', () => {
    const store = new TaskListStore();
    store.today = '2026-09-29';
    const tasks = [
      { ...task, taskId: 'future', text: 'Future @due(2026-10-01)' },
      { ...task, taskId: 'late', text: 'Late @due(2026-09-28)' },
      { ...task, taskId: 'done', text: 'Done @due(2026-09-28)', completed: true },
      { ...task, taskId: 'today', text: 'Today @due(2026-09-29)' },
      { ...task, taskId: 'none', text: 'No date' }
    ];
    store.groups = [{ noteId: 'note-1', notePath: task.notePath, noteTitle: 'Tasks', fileName: 'Tasks.md', noteHidden: false, noteCollapsed: false, displayTasks: tasks, displayCount: 5, hiddenCount: 0, visibleCount: 5 }];
    expect(store.dateGroups[0].displayTasks.map((task) => task.taskId)).toEqual(tasks.map((task) => task.taskId));
    store.dateFilter = 'overdue';
    expect(store.dateGroups[0].displayTasks.map((task) => task.taskId)).toEqual(['late']);
    store.dateFilter = 'today'; expect(store.dateGroups[0].displayCount).toBe(1);
    store.today = '2026-09-30'; expect(store.dateGroups).toHaveLength(0);
    store.dateFilter = 'upcoming'; expect(store.dateGroups[0].displayTasks[0].taskId).toBe('future');
    store.dateFilter = 'undated'; expect(store.dateGroups[0].displayTasks[0].taskId).toBe('none');
    store.dateFilter = 'all'; store.dueDateSort = true;
    expect(store.dateGroups[0].displayTasks.map((task) => task.taskId)).toEqual(['late', 'done', 'today', 'future', 'none']);
    expect(store.groups[0].displayTasks[0].taskId).toBe('future');
  });
  it('routes due dates through dirty documents before the closed-note command', async () => {
    mocks.routeTaskDocumentMutation.mockResolvedValue({ status: 'applied-to-open-document' });
    mocks.invoke.mockResolvedValue({ noteId: task.noteId, group: null });
    const store = new TaskListStore();
    await store.setDueDate(task, '2026-10-02');
    expect(mocks.routeTaskDocumentMutation).toHaveBeenCalledWith({ kind: 'setDueDate', taskId: task.taskId, noteId: task.noteId, notePath: task.notePath, dueDate: '2026-10-02' });
    expect(mocks.invoke).not.toHaveBeenCalledWith('set_task_due_date', expect.anything());
    mocks.routeTaskDocumentMutation.mockResolvedValue({ status: 'use-canonical-command' });
    await store.setDueDate(task, null);
    expect(mocks.invoke).toHaveBeenCalledWith('set_task_due_date', { taskId: task.taskId, dueDate: null, filter: 'all', showHidden: false });
  });
});

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function group(title: string) { return { noteId: task.noteId, notePath: task.notePath, noteTitle: title, fileName: 'Tasks.md', noteHidden: false, noteCollapsed: false, displayTasks: [task], displayCount: 1, hiddenCount: 0, visibleCount: 1 }; }

describe('task projection admission', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.bootstrap.mockReset(); mocks.subscribe.mockClear(); mocks.routeTaskDocumentMutation.mockResolvedValue({ status: 'use-canonical-command' }); });
  it('does not attach subscriptions or publish a load after disposal during bootstrap', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: { getItem: () => null } });
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const bootstrap = deferred<void>(); const load = deferred<ReturnType<typeof group>[]>();
    mocks.bootstrap.mockReturnValue(bootstrap.promise); mocks.invoke.mockReturnValue(load.promise);
    const store = new TaskListStore(); const dispose = store.initialize(); dispose();
    bootstrap.resolve(); load.resolve([group('retired')]); await bootstrap.promise; await load.promise;
    expect(mocks.subscribe).not.toHaveBeenCalled(); expect(store.groups).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });
  it('handles bootstrap rejection and disposes calendar subscriptions', async () => {
    vi.useFakeTimers(); vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: { getItem: () => null } }); vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() }); mocks.bootstrap.mockRejectedValue(new Error('offline')); mocks.invoke.mockResolvedValue([]);
    const store = new TaskListStore(); const dispose = store.initialize();
    await mocks.bootstrap.mock.results[0].value.catch(() => {});
    expect(store.errorMessage).toBe('Unable to subscribe to task updates.'); dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects old filter responses and reversed same-note refreshes', async () => {
    const old = deferred<unknown>(); const newer = deferred<unknown>();
    mocks.invoke.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const store = new TaskListStore(); store.groups = [group('original')];
    const one = store.refreshGroup(task.noteId); const two = store.refreshGroup(task.noteId);
    newer.resolve({ noteId: task.noteId, group: group('new') }); await two;
    old.resolve({ noteId: task.noteId, group: group('old') }); await one;
    expect(store.groups[0].noteTitle).toBe('new');
    const stale = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([group('filtered')]);
    const refresh = store.refreshGroup(task.noteId); store.filter = 'open'; await store.load();
    stale.resolve({ noteId: task.noteId, group: group('wrong filter') }); await refresh;
    expect(store.groups[0].noteTitle).toBe('filtered');
  });
  it('does not roll back newer projections after an old reorder fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const order = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(order.promise).mockResolvedValueOnce([group('new')]);
    const store = new TaskListStore(); store.groups = [group('one'), { ...group('two'), noteId: 'note-2' }];
    const reorder = store.reorderNote(0, 1); await store.load(); order.reject(new Error('late')); await reorder;
    expect(store.groups.map(g => g.noteTitle)).toEqual(['new']); expect(store.errorMessage).toBe('');
  });
  it('admits only one pending reorder and restores the persisted order on failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const write = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(write.promise);
    const store = new TaskListStore();
    store.groups = [group('one'), { ...group('two'), noteId: 'note-2' }, { ...group('three'), noteId: 'note-3' }];
    const first = store.reorderNote(0, 1);
    expect(store.isReordering).toBe(true);
    await store.reorderNote(1, 2);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(store.groups.map(g => g.noteTitle)).toEqual(['two', 'one', 'three']);
    write.reject(new Error('offline')); await first;
    expect(store.groups.map(g => g.noteTitle)).toEqual(['one', 'two', 'three']);
    expect(store.isReordering).toBe(false);
    expect(store.errorMessage).toBe('Unable to save note order.');
  });
  it('refreshes a committed mutation in the current view without retrying it', async () => {
    const write = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(write.promise).mockResolvedValueOnce([group('filter')]).mockResolvedValueOnce({ noteId: task.noteId, group: group('fresh') });
    const store = new TaskListStore(); store.groups = [group('initial')];
    const mutation = store.toggleTask(task); await Promise.resolve(); store.filter = 'open'; await store.load();
    write.resolve({ noteId: task.noteId, group: group('stale') }); await mutation;
    expect(store.groups[0].noteTitle).toBe('fresh'); expect(mocks.invoke.mock.calls.filter(([command]) => command === 'toggle_task')).toHaveLength(1);
  });
  it('restores failed order without discarding a group update admitted during the write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const write = deferred<unknown>();
    mocks.invoke.mockReturnValueOnce(write.promise).mockResolvedValueOnce({ noteId: task.noteId, group: group('updated') });
    const store = new TaskListStore(); store.groups = [group('one'), { ...group('two'), noteId: 'note-2' }];
    const reorder = store.reorderNote(0, 1); await store.refreshGroup(task.noteId);
    write.reject(new Error('offline')); await reorder;
    expect(store.groups.map(g => g.noteTitle)).toEqual(['updated', 'two']);
    expect(store.errorMessage).toBe('Unable to save note order.');
  });
  it('refreshes a newer filter after the pending reorder commits', async () => {
    const write = deferred<unknown>();
    mocks.invoke.mockReturnValueOnce(write.promise).mockResolvedValueOnce([group('old filter order')]).mockResolvedValueOnce([group('committed order')]);
    const store = new TaskListStore(); store.groups = [group('one'), { ...group('two'), noteId: 'note-2' }];
    const reorder = store.reorderNote(0, 1); store.filter = 'open'; await store.load();
    write.resolve(null); await reorder;
    expect(store.groups.map(g => g.noteTitle)).toEqual(['committed order']);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(['set_note_order', 'list_tasks', 'list_tasks']);
    expect(store.isReordering).toBe(false);
  });
  it.each([
    { starts: 'before', finishes: 'before' },
    { starts: 'before', finishes: 'after' },
    { starts: 'during', finishes: 'after' }
  ])('retains committed ranks when a refresh starts $starts and finishes $finishes the reorder write', async ({ starts, finishes }) => {
    const write = deferred<unknown>();
    const staleRead = deferred<unknown>();
    const original = [group('one'), { ...group('two'), noteId: 'note-2' }];
    const committed = [original[1], original[0]];
    let reads = 0;
    mocks.invoke.mockImplementation((command: string) => command === 'set_note_order'
      ? write.promise : reads++ === 0 ? staleRead.promise : Promise.resolve(committed));
    const store = new TaskListStore();
    store.groups = original;
    let refresh = starts === 'before' ? store.load({ background: true }) : undefined;
    const reorder = store.reorderNote(0, 1);
    if (!refresh) refresh = store.load({ background: true });
    if (finishes === 'before') {
      staleRead.resolve(original);
      await refresh;
    }
    write.resolve(null);
    await reorder;
    if (finishes === 'after') {
      staleRead.resolve(original);
      await refresh;
    }
    await vi.waitFor(() => expect(store.groups.map(group => group.noteId)).toEqual(['note-2', 'note-1']));
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'set_note_order')).toHaveLength(1);
    expect(store.isReordering).toBe(false);
  });
  it('keeps due-date failure observable and always releases the note lock', async () => {
    mocks.routeTaskDocumentMutation.mockRejectedValue(new Error('save failed'));
    const store = new TaskListStore(); await expect(store.setDueDate(task, null)).rejects.toThrow('save failed');
    expect(store.errorMessage).toBe('Unable to update the due date.'); expect(store.mutatingNoteIds).toEqual({});
  });
});

it('keeps a committed-warning status until the refresh succeeds, without retrying the write', async () => {
  mocks.invoke.mockReset(); mocks.routeTaskDocumentMutation.mockResolvedValue({ status: 'use-canonical-command' });
  const refresh = deferred<ReturnType<typeof group>[]>();
  mocks.invoke.mockResolvedValueOnce({ noteId: task.noteId, group: null, commitWarning: { message: 'pending', issues: [] } }).mockReturnValueOnce(refresh.promise);
  const store = new TaskListStore(); await store.deleteTask(task);
  expect(store.errorMessage).toBe('Task deleted; the task list is waiting for synchronization.');
  expect(store.deletingTaskKeys).toEqual({}); expect(store.mutatingNoteIds).toEqual({});
  refresh.resolve([]); await refresh.promise;
  expect(store.errorMessage).toBe(''); expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(['delete_task', 'list_tasks']);
});

it('does not let a full-load response overwrite a newer admitted group patch', async () => {
  mocks.invoke.mockReset(); const full = deferred<ReturnType<typeof group>[]>();
  mocks.invoke.mockReturnValueOnce(full.promise).mockResolvedValueOnce({ noteId: task.noteId, group: group('patch') }).mockResolvedValueOnce([group('authoritative')]);
  const store = new TaskListStore(); store.groups = [group('initial')];
  const loading = store.load(); await store.refreshGroup(task.noteId); full.resolve([group('stale')]); await loading;
  expect(store.groups[0].noteTitle).not.toBe('stale');
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(['list_tasks', 'get_task_group', 'list_tasks']);
});

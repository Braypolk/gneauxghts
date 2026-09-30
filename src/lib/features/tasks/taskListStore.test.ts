import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskItem } from './taskListStore.svelte';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  routeTaskDocumentMutation: vi.fn()
}));

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

  it('treats a committed canonical warning as success instead of a retryable mutation error', async () => {
    mocks.routeTaskDocumentMutation.mockResolvedValue({
      status: 'use-canonical-command'
    });
    mocks.invoke
      .mockResolvedValueOnce({
        noteId: task.noteId,
        notePath: task.notePath,
        group: null,
        commitWarning: {
          message: 'Canonical note file was saved; task projection is pending',
          issues: [
            {
              stage: 'taskProjectionUpsert',
              message: 'task database unavailable'
            }
          ]
        }
      })
      .mockResolvedValueOnce([]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new TaskListStore();

    await store.toggleTask(task);

    expect(mocks.invoke.mock.calls[0]).toEqual([
      'toggle_task',
      {
        taskId: task.taskId,
        filter: 'all',
        showHidden: false
      }
    ]);
    expect(store.errorMessage).not.toBe('Unable to update task completion.');
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

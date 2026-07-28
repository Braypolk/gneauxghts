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

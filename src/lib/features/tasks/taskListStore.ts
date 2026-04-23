import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
import { get, writable } from 'svelte/store';
import { storePendingTaskTarget } from '$lib/taskNavigation';

export interface TaskItem {
  noteId: string;
  taskKey: string;
  notePath: string;
  fileName: string;
  noteTitle: string;
  sectionLabel: string | null;
  text: string;
  completed: boolean;
  hidden: boolean;
  noteHidden: boolean;
  noteCollapsed: boolean;
  depth: number;
  lineNumber: number;
  createdAtMillis: number;
  updatedAtMillis: number;
}

export interface TaskGroup {
  noteId: string;
  notePath: string;
  noteTitle: string;
  fileName: string;
  noteHidden: boolean;
  noteCollapsed: boolean;
  displayTasks: TaskItem[];
  hiddenCount: number;
  visibleCount: number;
  displayCount: number;
}

export type TaskFilter = 'open' | 'completed' | 'all';

interface TaskListState {
  filter: TaskFilter;
  showHidden: boolean;
  tasks: TaskItem[];
  togglingTaskKeys: Record<string, boolean>;
  deletingTaskKeys: Record<string, boolean>;
  isLoading: boolean;
  errorMessage: string;
}

const TASK_FILTER_STORAGE_KEY = 'gneauxghts.master-task-filter';

function createInitialState(): TaskListState {
  return {
    filter: 'all',
    showHidden: false,
    tasks: [],
    togglingTaskKeys: {},
    deletingTaskKeys: {},
    isLoading: true,
    errorMessage: ''
  };
}

export function createTaskListStore() {
  const store = writable<TaskListState>(createInitialState());
  const { subscribe, update } = store;
  let activeRequest = 0;

  function patch(partial: Partial<TaskListState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function readStoredTaskFilter(): TaskFilter | null {
    if (typeof window === 'undefined') return null;

    const storedFilter = window.localStorage.getItem(TASK_FILTER_STORAGE_KEY);
    if (storedFilter === 'open' || storedFilter === 'completed' || storedFilter === 'all') {
      return storedFilter;
    }

    return null;
  }

  function persistTaskFilter(nextFilter: TaskFilter) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TASK_FILTER_STORAGE_KEY, nextFilter);
  }

  async function load({ background = false } = {}) {
    const requestId = ++activeRequest;

    if (!background) {
      patch({ isLoading: true });
    }

    try {
      const nextTasks = await invoke<TaskItem[]>('list_tasks', { filter: get(store).filter });

      if (requestId !== activeRequest) return;
      patch({
        tasks: nextTasks,
        errorMessage: ''
      });
    } catch (error) {
      if (requestId !== activeRequest) return;
      console.error('Failed to load tasks:', error);
      patch({ errorMessage: 'Unable to load the master task list.' });
    } finally {
      if (requestId === activeRequest) {
        patch({ isLoading: false });
      }
    }
  }

  function setActiveFilter(filter: TaskFilter) {
    if (get(store).filter === filter) return;
    patch({ filter });
    persistTaskFilter(filter);
    void load({ background: get(store).tasks.length > 0 });
  }

  function refresh() {
    void load({ background: get(store).tasks.length > 0 });
  }

  function toggleShowHidden() {
    patch({ showHidden: !get(store).showHidden });
  }

  function handleWindowFocus() {
    void load({ background: true });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void load({ background: true });
    }
  }

  function updateTasksOptimistically(transform: (tasks: TaskItem[]) => TaskItem[]) {
    const previousTasks = get(store).tasks;
    patch({ tasks: transform(previousTasks) });
    return previousTasks;
  }

  async function toggleNoteCollapsed(group: TaskGroup) {
    const previousTasks = updateTasksOptimistically((tasks) =>
      tasks.map((candidate) =>
        candidate.noteId === group.noteId
          ? { ...candidate, noteCollapsed: !group.noteCollapsed }
          : candidate
      )
    );

    try {
      await invoke('set_note_collapsed', {
        noteId: group.noteId,
        collapsed: !group.noteCollapsed
      });
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to update collapsed note state:', error);
      patch({
        tasks: previousTasks,
        errorMessage: 'Unable to save collapsed files.'
      });
    }
  }

  async function setTaskHidden(task: TaskItem, hidden: boolean) {
    const previousTasks = updateTasksOptimistically((tasks) =>
      tasks.map((candidate) =>
        candidate.taskKey === task.taskKey ? { ...candidate, hidden } : candidate
      )
    );

    try {
      await invoke('set_task_hidden', {
        taskKey: task.taskKey,
        hidden
      });
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to update hidden task state:', error);
      patch({
        tasks: previousTasks,
        errorMessage: 'Unable to update hidden tasks.'
      });
    }
  }

  async function toggleTask(task: TaskItem) {
    update((state) => ({
      ...state,
      togglingTaskKeys: {
        ...state.togglingTaskKeys,
        [task.taskKey]: true
      }
    }));

    try {
      await invoke('toggle_task', {
        notePath: task.notePath,
        lineNumber: task.lineNumber,
        taskText: task.text
      });
      patch({ errorMessage: '' });
      await load({ background: true });
    } catch (error) {
      console.error('Failed to toggle task:', error);
      patch({ errorMessage: 'Unable to update task completion.' });
    } finally {
      update((state) => {
        const nextTogglingTaskKeys = { ...state.togglingTaskKeys };
        delete nextTogglingTaskKeys[task.taskKey];
        return {
          ...state,
          togglingTaskKeys: nextTogglingTaskKeys
        };
      });
    }
  }

  async function setNoteHidden(group: TaskGroup, hidden: boolean) {
    const previousTasks = updateTasksOptimistically((tasks) =>
      tasks.map((candidate) =>
        candidate.noteId === group.noteId ? { ...candidate, noteHidden: hidden } : candidate
      )
    );

    try {
      await invoke('set_note_hidden', {
        noteId: group.noteId,
        hidden
      });
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to update hidden note state:', error);
      patch({
        tasks: previousTasks,
        errorMessage: 'Unable to update hidden files.'
      });
    }
  }

  function buildNoteOrder() {
    const noteIds = [];
    const seen = new Set<string>();

    for (const task of get(store).tasks) {
      if (seen.has(task.noteId)) continue;
      seen.add(task.noteId);
      noteIds.push(task.noteId);
    }

    return noteIds;
  }

  async function moveNote(group: TaskGroup, direction: 'up' | 'down') {
    const noteOrder = buildNoteOrder();
    const currentIndex = noteOrder.indexOf(group.noteId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= noteOrder.length) return;

    [noteOrder[currentIndex], noteOrder[targetIndex]] = [noteOrder[targetIndex], noteOrder[currentIndex]];

    const previousTasks = get(store).tasks;
    const noteRank = new Map(noteOrder.map((noteId, index) => [noteId, index]));
    patch({
      tasks: [...previousTasks].sort((left, right) => {
        const leftRank = noteRank.get(left.noteId) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = noteRank.get(right.noteId) ?? Number.MAX_SAFE_INTEGER;

        return (
          leftRank - rightRank ||
          left.lineNumber - right.lineNumber ||
          left.text.localeCompare(right.text)
        );
      })
    });

    try {
      await invoke('set_note_order', { noteIds: noteOrder });
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to save note order:', error);
      patch({
        tasks: previousTasks,
        errorMessage: 'Unable to save note order.'
      });
    }
  }

  async function reorderNote(fromIndex: number, toIndex: number) {
    const noteOrder = buildNoteOrder();
    if (fromIndex < 0 || fromIndex >= noteOrder.length) return;
    if (toIndex < 0 || toIndex >= noteOrder.length) return;
    if (fromIndex === toIndex) return;

    const [movedNoteId] = noteOrder.splice(fromIndex, 1);
    noteOrder.splice(toIndex, 0, movedNoteId);

    const previousTasks = get(store).tasks;
    const noteRank = new Map(noteOrder.map((noteId, index) => [noteId, index]));
    patch({
      tasks: [...previousTasks].sort((left, right) => {
        const leftRank = noteRank.get(left.noteId) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = noteRank.get(right.noteId) ?? Number.MAX_SAFE_INTEGER;

        return (
          leftRank - rightRank ||
          left.lineNumber - right.lineNumber ||
          left.text.localeCompare(right.text)
        );
      })
    });

    try {
      await invoke('set_note_order', { noteIds: noteOrder });
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to save note order:', error);
      patch({
        tasks: previousTasks,
        errorMessage: 'Unable to save note order.'
      });
    }
  }

  async function openTask(task: TaskItem) {
    try {
      await invoke('open_note', { noteId: task.noteId, path: task.notePath });
      storePendingTaskTarget({
        noteId: task.noteId,
        notePath: task.notePath,
        text: task.text,
        lineNumber: task.lineNumber,
        sectionLabel: task.sectionLabel
      });
      await goto('/');
    } catch (error) {
      console.error('Failed to open task note:', error);
      patch({ errorMessage: `Unable to open ${task.noteTitle}.` });
    }
  }

  async function deleteTask(task: TaskItem) {
    update((state) => ({
      ...state,
      deletingTaskKeys: {
        ...state.deletingTaskKeys,
        [task.taskKey]: true
      }
    }));

    try {
      await invoke('delete_task', {
        notePath: task.notePath,
        lineNumber: task.lineNumber,
        taskText: task.text,
        taskKey: task.taskKey
      });
      patch({ errorMessage: '' });
      await load({ background: true });
    } catch (error) {
      console.error('Failed to delete task:', error);
      patch({ errorMessage: 'Unable to delete task.' });
    } finally {
      update((state) => {
        const nextDeletingTaskKeys = { ...state.deletingTaskKeys };
        delete nextDeletingTaskKeys[task.taskKey];
        return {
          ...state,
          deletingTaskKeys: nextDeletingTaskKeys
        };
      });
    }
  }

  function initialize() {
    const storedFilter = readStoredTaskFilter();
    if (storedFilter) {
      patch({ filter: storedFilter });
    }

    void load();
  }

  return {
    subscribe,
    initialize,
    load,
    refresh,
    setActiveFilter,
    toggleShowHidden,
    handleWindowFocus,
    handleVisibilityChange,
    toggleNoteCollapsed,
    setTaskHidden,
    toggleTask,
    setNoteHidden,
    moveNote,
    reorderNote,
    openTask,
    deleteTask
  };
}

import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
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

const TASK_FILTER_STORAGE_KEY = 'gneauxghts.master-task-filter';

interface TaskListControllerDeps {
  getFilter: () => TaskFilter;
  setFilter: (filter: TaskFilter) => void;
  getShowHidden: () => boolean;
  setShowHidden: (value: boolean) => void;
  getTasks: () => TaskItem[];
  setTasks: (tasks: TaskItem[]) => void;
  getTogglingTaskKeys: () => Record<string, boolean>;
  setTogglingTaskKeys: (value: Record<string, boolean>) => void;
  getDeletingTaskKeys: () => Record<string, boolean>;
  setDeletingTaskKeys: (value: Record<string, boolean>) => void;
  setIsLoading: (value: boolean) => void;
  setErrorMessage: (value: string) => void;
}

export function createTaskListController({
  getFilter,
  setFilter,
  getShowHidden,
  setShowHidden,
  getTasks,
  setTasks,
  getTogglingTaskKeys,
  setTogglingTaskKeys,
  getDeletingTaskKeys,
  setDeletingTaskKeys,
  setIsLoading,
  setErrorMessage
}: TaskListControllerDeps) {
  let activeRequest = 0;

  async function loadTasks({ background = false } = {}) {
    const requestId = ++activeRequest;

    if (!background) {
      setIsLoading(true);
    }

    try {
      const nextTasks = await invoke<TaskItem[]>('list_tasks', { filter: getFilter() });

      if (requestId !== activeRequest) return;
      setTasks(nextTasks);
      setErrorMessage('');
    } catch (error) {
      if (requestId !== activeRequest) return;
      console.error('Failed to load tasks:', error);
      setErrorMessage('Unable to load the master task list.');
    } finally {
      if (requestId === activeRequest) {
        setIsLoading(false);
      }
    }
  }

  function setActiveFilter(nextFilter: TaskFilter) {
    if (getFilter() === nextFilter) return;
    setFilter(nextFilter);
    persistTaskFilter(nextFilter);
    void loadTasks({ background: getTasks().length > 0 });
  }

  function refreshTasks() {
    void loadTasks({ background: getTasks().length > 0 });
  }

  function toggleShowHidden() {
    setShowHidden(!getShowHidden());
  }

  function persistTaskFilter(nextFilter: TaskFilter) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TASK_FILTER_STORAGE_KEY, nextFilter);
  }

  function readStoredTaskFilter(): TaskFilter | null {
    if (typeof window === 'undefined') return null;

    const storedFilter = window.localStorage.getItem(TASK_FILTER_STORAGE_KEY);
    if (storedFilter === 'open' || storedFilter === 'completed' || storedFilter === 'all') {
      return storedFilter;
    }

    return null;
  }

  function handleWindowFocus() {
    void loadTasks({ background: true });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void loadTasks({ background: true });
    }
  }

  function updateTasksOptimistically(transform: (tasks: TaskItem[]) => TaskItem[]) {
    const previousTasks = getTasks();
    setTasks(transform(previousTasks));
    return previousTasks;
  }

  async function toggleNoteCollapsed(group: TaskGroup) {
    const previousTasks = updateTasksOptimistically((tasks) =>
      tasks.map((candidate) =>
        candidate.noteId === group.noteId ? { ...candidate, noteCollapsed: !group.noteCollapsed } : candidate
      )
    );

    try {
      await invoke('set_note_collapsed', {
        noteId: group.noteId,
        collapsed: !group.noteCollapsed
      });
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to update collapsed note state:', error);
      setTasks(previousTasks);
      setErrorMessage('Unable to save collapsed files.');
    }
  }

  async function setTaskHidden(task: TaskItem, hidden: boolean) {
    const previousTasks = updateTasksOptimistically((tasks) =>
      tasks.map((candidate) => (candidate.taskKey === task.taskKey ? { ...candidate, hidden } : candidate))
    );

    try {
      await invoke('set_task_hidden', {
        taskKey: task.taskKey,
        hidden
      });
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to update hidden task state:', error);
      setTasks(previousTasks);
      setErrorMessage('Unable to update hidden tasks.');
    }
  }

  async function toggleTask(task: TaskItem) {
    setTogglingTaskKeys({
      ...getTogglingTaskKeys(),
      [task.taskKey]: true
    });

    try {
      await invoke('toggle_task', {
        notePath: task.notePath,
        lineNumber: task.lineNumber,
        taskText: task.text
      });
      setErrorMessage('');
      await loadTasks({ background: true });
    } catch (error) {
      console.error('Failed to toggle task:', error);
      setErrorMessage('Unable to update task completion.');
    } finally {
      const nextTogglingTaskKeys = { ...getTogglingTaskKeys() };
      delete nextTogglingTaskKeys[task.taskKey];
      setTogglingTaskKeys(nextTogglingTaskKeys);
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
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to update hidden note state:', error);
      setTasks(previousTasks);
      setErrorMessage('Unable to update hidden files.');
    }
  }

  function buildNoteOrder() {
    const noteIds = [];
    const seen = new Set<string>();

    for (const task of getTasks()) {
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

    const previousTasks = getTasks();
    const noteRank = new Map(noteOrder.map((noteId, index) => [noteId, index]));
    setTasks(
      [...getTasks()].sort((left, right) => {
        const leftRank = noteRank.get(left.noteId) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = noteRank.get(right.noteId) ?? Number.MAX_SAFE_INTEGER;

        return leftRank - rightRank || left.lineNumber - right.lineNumber || left.text.localeCompare(right.text);
      })
    );

    try {
      await invoke('set_note_order', { noteIds: noteOrder });
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to save note order:', error);
      setTasks(previousTasks);
      setErrorMessage('Unable to save note order.');
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
      setErrorMessage(`Unable to open ${task.noteTitle}.`);
    }
  }

  async function deleteTask(task: TaskItem) {
    setDeletingTaskKeys({ ...getDeletingTaskKeys(), [task.taskKey]: true });
    try {
      await invoke('delete_task', {
        notePath: task.notePath,
        lineNumber: task.lineNumber,
        taskText: task.text,
        taskKey: task.taskKey
      });
      setErrorMessage('');
      await loadTasks({ background: true });
    } catch (error) {
      console.error('Failed to delete task:', error);
      setErrorMessage('Unable to delete task.');
    } finally {
      const next = { ...getDeletingTaskKeys() };
      delete next[task.taskKey];
      setDeletingTaskKeys(next);
    }
  }

  return {
    loadTasks,
    readStoredTaskFilter,
    setActiveFilter,
    refreshTasks,
    toggleShowHidden,
    handleWindowFocus,
    handleVisibilityChange,
    toggleNoteCollapsed,
    setTaskHidden,
    toggleTask,
    setNoteHidden,
    moveNote,
    openTask,
    deleteTask
  };
}

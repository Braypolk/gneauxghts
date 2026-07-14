import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
import { get, writable } from 'svelte/store';
import { storePendingTaskTarget } from '$lib/taskNavigation';
import { appStore } from '$lib/app/appStore.svelte';

export interface TaskItem {
  noteId: string;
  taskKey: string;
  taskId: string;
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
  editorLineNumber?: number;
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

interface TaskListGroupPatch {
  noteId: string;
  notePath?: string | null;
  group?: TaskGroup | null;
}

interface TaskListState {
  filter: TaskFilter;
  showHidden: boolean;
  groups: TaskGroup[];
  togglingTaskKeys: Record<string, boolean>;
  deletingTaskKeys: Record<string, boolean>;
  mutatingNoteIds: Record<string, boolean>;
  isLoading: boolean;
  errorMessage: string;
}

const TASK_FILTER_STORAGE_KEY = 'gneauxghts.master-task-filter';

function createInitialState(): TaskListState {
  return {
    filter: 'all',
    showHidden: false,
    groups: [],
    togglingTaskKeys: {},
    deletingTaskKeys: {},
    mutatingNoteIds: {},
    isLoading: true,
    errorMessage: ''
  };
}

export function createTaskListStore() {
  const store = writable<TaskListState>(createInitialState());
  const { subscribe, update } = store;
  let activeRequest = 0;
  let disposeNoteSaved: (() => void) | null = null;
  let disposeVaultNoteChanged: (() => void) | null = null;
  let disposeVaultChanged: (() => void) | null = null;

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
      const { filter, showHidden } = get(store);
      const nextGroups = await invoke<TaskGroup[]>('list_tasks', { filter, showHidden });

      if (requestId !== activeRequest) return;
      patch({
        groups: nextGroups,
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
    void load({ background: get(store).groups.length > 0 });
  }

  function refresh() {
    void load({ background: get(store).groups.length > 0 });
  }

  function toggleShowHidden() {
    patch({ showHidden: !get(store).showHidden });
    void load({ background: get(store).groups.length > 0 });
  }

  function handleWindowFocus() {
    void load({ background: true });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void load({ background: true });
    }
  }

  function currentViewParams() {
    const { filter, showHidden } = get(store);
    return { filter, showHidden };
  }

  function setNoteMutating(noteId: string, mutating: boolean) {
    update((state) => {
      const mutatingNoteIds = { ...state.mutatingNoteIds };
      if (mutating) {
        mutatingNoteIds[noteId] = true;
      } else {
        delete mutatingNoteIds[noteId];
      }
      return { ...state, mutatingNoteIds };
    });
  }

  function applyGroupPatch(groupPatch: TaskListGroupPatch) {
    const existingIndex = get(store).groups.findIndex((group) => group.noteId === groupPatch.noteId);

    if (groupPatch.group && existingIndex === -1) {
      void load({ background: true });
      return;
    }

    update((state) => {
      if (!groupPatch.group) {
        if (existingIndex === -1) return state;
        return {
          ...state,
          groups: state.groups.filter((group) => group.noteId !== groupPatch.noteId)
        };
      }

      const groups = [...state.groups];
      groups[existingIndex] = groupPatch.group;
      return { ...state, groups };
    });
  }

  async function refreshGroup(noteId: string) {
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('get_task_group', {
        noteId,
        ...currentViewParams()
      });
      applyGroupPatch(groupPatch);
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to refresh task group:', error);
      void load({ background: true });
    }
  }

  async function toggleNoteCollapsed(group: TaskGroup) {
    if (get(store).mutatingNoteIds[group.noteId]) return;
    setNoteMutating(group.noteId, true);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_note_collapsed', {
        noteId: group.noteId,
        collapsed: !group.noteCollapsed,
        ...currentViewParams()
      });
      applyGroupPatch(groupPatch);
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to update collapsed note state:', error);
      patch({ errorMessage: 'Unable to save collapsed files.' });
    } finally {
      setNoteMutating(group.noteId, false);
    }
  }

  async function setTaskHidden(task: TaskItem, hidden: boolean) {
    if (get(store).mutatingNoteIds[task.noteId]) return;
    setNoteMutating(task.noteId, true);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_task_hidden', {
        taskId: task.taskId,
        hidden,
        ...currentViewParams()
      });
      applyGroupPatch(groupPatch);
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to update hidden task state:', error);
      patch({ errorMessage: 'Unable to update hidden tasks.' });
    } finally {
      setNoteMutating(task.noteId, false);
    }
  }

  async function toggleTask(task: TaskItem) {
    if (get(store).mutatingNoteIds[task.noteId]) return;
    setNoteMutating(task.noteId, true);
    update((state) => ({
      ...state,
      togglingTaskKeys: {
        ...state.togglingTaskKeys,
        [task.taskKey]: true
      }
    }));

    try {
      const groupPatch = await invoke<TaskListGroupPatch>('toggle_task', {
        taskId: task.taskId,
        ...currentViewParams()
      });
      applyGroupPatch(groupPatch);
      patch({ errorMessage: '' });
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
      setNoteMutating(task.noteId, false);
    }
  }

  async function setNoteHidden(group: TaskGroup, hidden: boolean) {
    if (get(store).mutatingNoteIds[group.noteId]) return;
    setNoteMutating(group.noteId, true);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_note_hidden', {
        noteId: group.noteId,
        hidden,
        ...currentViewParams()
      });
      applyGroupPatch(groupPatch);
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to update hidden note state:', error);
      patch({ errorMessage: 'Unable to update hidden files.' });
    } finally {
      setNoteMutating(group.noteId, false);
    }
  }

  function buildNoteOrder() {
    return get(store).groups.map((group) => group.noteId);
  }

  async function reorderNote(fromIndex: number, toIndex: number) {
    const noteOrder = buildNoteOrder();
    if (fromIndex < 0 || fromIndex >= noteOrder.length) return;
    if (toIndex < 0 || toIndex >= noteOrder.length) return;
    if (fromIndex === toIndex) return;

    const [movedNoteId] = noteOrder.splice(fromIndex, 1);
    noteOrder.splice(toIndex, 0, movedNoteId);

    const previousGroups = get(store).groups;
    const noteRank = new Map(noteOrder.map((noteId, index) => [noteId, index]));
    patch({
      groups: [...previousGroups].sort(
        (left, right) =>
          (noteRank.get(left.noteId) ?? Number.MAX_SAFE_INTEGER) -
          (noteRank.get(right.noteId) ?? Number.MAX_SAFE_INTEGER)
      )
    });

    try {
      await invoke('set_note_order', { noteIds: noteOrder });
      patch({ errorMessage: '' });
    } catch (error) {
      console.error('Failed to save note order:', error);
      patch({
        groups: previousGroups,
        errorMessage: 'Unable to save note order.'
      });
    }
  }

  async function openTask(task: TaskItem) {
    try {
      storePendingTaskTarget({
        noteId: task.noteId,
        notePath: task.notePath,
        text: task.text,
        lineNumber: task.lineNumber,
        sectionLabel: task.sectionLabel,
        ...(task.editorLineNumber != null ? { editorLineNumber: task.editorLineNumber } : {})
      });
      await goto('/');
    } catch (error) {
      console.error('Failed to navigate to note for task:', error);
      patch({ errorMessage: `Unable to open ${task.noteTitle}.` });
    }
  }

  async function deleteTask(task: TaskItem) {
    if (get(store).mutatingNoteIds[task.noteId]) return;
    setNoteMutating(task.noteId, true);
    update((state) => ({
      ...state,
      deletingTaskKeys: {
        ...state.deletingTaskKeys,
        [task.taskKey]: true
      }
    }));

    try {
      const groupPatch = await invoke<TaskListGroupPatch>('delete_task', {
        taskId: task.taskId,
        ...currentViewParams()
      });
      applyGroupPatch(groupPatch);
      patch({ errorMessage: '' });
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
      setNoteMutating(task.noteId, false);
    }
  }

  function initialize() {
    const storedFilter = readStoredTaskFilter();
    if (storedFilter) {
      patch({ filter: storedFilter });
    }

    void appStore.bootstrap().then(() => {
      disposeNoteSaved?.();
      disposeVaultNoteChanged?.();
      disposeVaultChanged?.();
      disposeNoteSaved = appStore.subscribeNoteSaved((event) => {
        if (event.noteId) {
          void refreshGroup(event.noteId);
        } else {
          void load({ background: true });
        }
      });
      disposeVaultNoteChanged = appStore.subscribeVaultNoteChanged((event) => {
        if (event.documentKind && event.documentKind !== 'note') return;
        if (event.source === 'taskMutation') return;
        void load({ background: true });
      });
      disposeVaultChanged = appStore.subscribeVaultChanged(() => {
        void load({ background: true });
      });
    });
    void load();

    return () => {
      disposeNoteSaved?.();
      disposeVaultNoteChanged?.();
      disposeVaultChanged?.();
      disposeNoteSaved = null;
      disposeVaultNoteChanged = null;
      disposeVaultChanged = null;
    };
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
    reorderNote,
    openTask,
    deleteTask
  };
}

import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
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

const TASK_FILTER_STORAGE_KEY = 'gneauxghts.master-task-filter';

export class TaskListStore {
  filter = $state<TaskFilter>('all');
  showHidden = $state(false);
  groups = $state<TaskGroup[]>([]);
  togglingTaskKeys = $state<Record<string, boolean>>({});
  deletingTaskKeys = $state<Record<string, boolean>>({});
  mutatingNoteIds = $state<Record<string, boolean>>({});
  isLoading = $state(true);
  errorMessage = $state('');

  #activeRequest = 0;
  #disposeNoteSaved: (() => void) | null = null;
  #disposeVaultNoteChanged: (() => void) | null = null;
  #disposeVaultChanged: (() => void) | null = null;

  #readStoredTaskFilter(): TaskFilter | null {
    if (typeof window === 'undefined') return null;

    const storedFilter = window.localStorage.getItem(TASK_FILTER_STORAGE_KEY);
    if (storedFilter === 'open' || storedFilter === 'completed' || storedFilter === 'all') {
      return storedFilter;
    }

    return null;
  }

  #persistTaskFilter(nextFilter: TaskFilter) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TASK_FILTER_STORAGE_KEY, nextFilter);
  }

  async load({ background = false } = {}) {
    const requestId = ++this.#activeRequest;

    if (!background) {
      this.isLoading = true;
    }

    try {
      const nextGroups = await invoke<TaskGroup[]>('list_tasks', {
        filter: this.filter,
        showHidden: this.showHidden
      });

      if (requestId !== this.#activeRequest) return;
      this.groups = nextGroups;
      this.errorMessage = '';
    } catch (error) {
      if (requestId !== this.#activeRequest) return;
      console.error('Failed to load tasks:', error);
      this.errorMessage = 'Unable to load the master task list.';
    } finally {
      if (requestId === this.#activeRequest) {
        this.isLoading = false;
      }
    }
  }

  setActiveFilter(filter: TaskFilter) {
    if (this.filter === filter) return;
    this.filter = filter;
    this.#persistTaskFilter(filter);
    void this.load({ background: this.groups.length > 0 });
  }

  refresh() {
    void this.load({ background: this.groups.length > 0 });
  }

  toggleShowHidden() {
    this.showHidden = !this.showHidden;
    void this.load({ background: this.groups.length > 0 });
  }

  handleWindowFocus() {
    void this.load({ background: true });
  }

  handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void this.load({ background: true });
    }
  }

  #currentViewParams() {
    return { filter: this.filter, showHidden: this.showHidden };
  }

  #setNoteMutating(noteId: string, mutating: boolean) {
    const mutatingNoteIds = { ...this.mutatingNoteIds };
    if (mutating) {
      mutatingNoteIds[noteId] = true;
    } else {
      delete mutatingNoteIds[noteId];
    }
    this.mutatingNoteIds = mutatingNoteIds;
  }

  #applyGroupPatch(groupPatch: TaskListGroupPatch) {
    const existingIndex = this.groups.findIndex((group) => group.noteId === groupPatch.noteId);

    if (groupPatch.group && existingIndex === -1) {
      void this.load({ background: true });
      return;
    }

    if (!groupPatch.group) {
      if (existingIndex === -1) return;
      this.groups = this.groups.filter((group) => group.noteId !== groupPatch.noteId);
      return;
    }

    const groups = [...this.groups];
    groups[existingIndex] = groupPatch.group;
    this.groups = groups;
  }

  async refreshGroup(noteId: string) {
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('get_task_group', {
        noteId,
        ...this.#currentViewParams()
      });
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      console.error('Failed to refresh task group:', error);
      void this.load({ background: true });
    }
  }

  async toggleNoteCollapsed(group: TaskGroup) {
    if (this.mutatingNoteIds[group.noteId]) return;
    this.#setNoteMutating(group.noteId, true);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_note_collapsed', {
        noteId: group.noteId,
        collapsed: !group.noteCollapsed,
        ...this.#currentViewParams()
      });
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      console.error('Failed to update collapsed note state:', error);
      this.errorMessage = 'Unable to save collapsed files.';
    } finally {
      this.#setNoteMutating(group.noteId, false);
    }
  }

  async setTaskHidden(task: TaskItem, hidden: boolean) {
    if (this.mutatingNoteIds[task.noteId]) return;
    this.#setNoteMutating(task.noteId, true);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_task_hidden', {
        taskId: task.taskId,
        hidden,
        ...this.#currentViewParams()
      });
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      console.error('Failed to update hidden task state:', error);
      this.errorMessage = 'Unable to update hidden tasks.';
    } finally {
      this.#setNoteMutating(task.noteId, false);
    }
  }

  async toggleTask(task: TaskItem) {
    if (this.mutatingNoteIds[task.noteId]) return;
    this.#setNoteMutating(task.noteId, true);
    this.togglingTaskKeys = {
      ...this.togglingTaskKeys,
      [task.taskKey]: true
    };

    try {
      const groupPatch = await invoke<TaskListGroupPatch>('toggle_task', {
        taskId: task.taskId,
        ...this.#currentViewParams()
      });
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      console.error('Failed to toggle task:', error);
      this.errorMessage = 'Unable to update task completion.';
    } finally {
      const nextTogglingTaskKeys = { ...this.togglingTaskKeys };
      delete nextTogglingTaskKeys[task.taskKey];
      this.togglingTaskKeys = nextTogglingTaskKeys;
      this.#setNoteMutating(task.noteId, false);
    }
  }

  async setNoteHidden(group: TaskGroup, hidden: boolean) {
    if (this.mutatingNoteIds[group.noteId]) return;
    this.#setNoteMutating(group.noteId, true);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_note_hidden', {
        noteId: group.noteId,
        hidden,
        ...this.#currentViewParams()
      });
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      console.error('Failed to update hidden note state:', error);
      this.errorMessage = 'Unable to update hidden files.';
    } finally {
      this.#setNoteMutating(group.noteId, false);
    }
  }

  #buildNoteOrder() {
    return this.groups.map((group) => group.noteId);
  }

  async reorderNote(fromIndex: number, toIndex: number) {
    const noteOrder = this.#buildNoteOrder();
    if (fromIndex < 0 || fromIndex >= noteOrder.length) return;
    if (toIndex < 0 || toIndex >= noteOrder.length) return;
    if (fromIndex === toIndex) return;

    const [movedNoteId] = noteOrder.splice(fromIndex, 1);
    if (!movedNoteId) return;
    noteOrder.splice(toIndex, 0, movedNoteId);

    const previousGroups = this.groups;
    const noteRank = new Map(noteOrder.map((noteId, index) => [noteId, index]));
    this.groups = [...previousGroups].sort(
      (left, right) =>
        (noteRank.get(left.noteId) ?? Number.MAX_SAFE_INTEGER) -
        (noteRank.get(right.noteId) ?? Number.MAX_SAFE_INTEGER)
    );

    try {
      await invoke('set_note_order', { noteIds: noteOrder });
      this.errorMessage = '';
    } catch (error) {
      console.error('Failed to save note order:', error);
      this.groups = previousGroups;
      this.errorMessage = 'Unable to save note order.';
    }
  }

  async openTask(task: TaskItem) {
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
      this.errorMessage = `Unable to open ${task.noteTitle}.`;
    }
  }

  async deleteTask(task: TaskItem) {
    if (this.mutatingNoteIds[task.noteId]) return;
    this.#setNoteMutating(task.noteId, true);
    this.deletingTaskKeys = {
      ...this.deletingTaskKeys,
      [task.taskKey]: true
    };

    try {
      const groupPatch = await invoke<TaskListGroupPatch>('delete_task', {
        taskId: task.taskId,
        ...this.#currentViewParams()
      });
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      console.error('Failed to delete task:', error);
      this.errorMessage = 'Unable to delete task.';
    } finally {
      const nextDeletingTaskKeys = { ...this.deletingTaskKeys };
      delete nextDeletingTaskKeys[task.taskKey];
      this.deletingTaskKeys = nextDeletingTaskKeys;
      this.#setNoteMutating(task.noteId, false);
    }
  }

  initialize() {
    const storedFilter = this.#readStoredTaskFilter();
    if (storedFilter) {
      this.filter = storedFilter;
    }

    void appStore.bootstrap().then(() => {
      this.#disposeNoteSaved?.();
      this.#disposeVaultNoteChanged?.();
      this.#disposeVaultChanged?.();
      this.#disposeNoteSaved = appStore.subscribeNoteSaved((event) => {
        if (event.noteId) {
          void this.refreshGroup(event.noteId);
        } else {
          void this.load({ background: true });
        }
      });
      this.#disposeVaultNoteChanged = appStore.subscribeVaultNoteChanged((event) => {
        if (event.documentKind && event.documentKind !== 'note') return;
        if (event.source === 'taskMutation') return;
        void this.load({ background: true });
      });
      this.#disposeVaultChanged = appStore.subscribeVaultChanged(() => {
        void this.load({ background: true });
      });
    });
    void this.load();

    return () => {
      this.#disposeNoteSaved?.();
      this.#disposeVaultNoteChanged?.();
      this.#disposeVaultChanged?.();
      this.#disposeNoteSaved = null;
      this.#disposeVaultNoteChanged = null;
      this.#disposeVaultChanged = null;
    };
  }
}

export function createTaskListStore() {
  return new TaskListStore();
}

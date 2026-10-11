import { localCalendarDate, matchesTaskDateFilter, taskDueDate, subscribeCalendarDay, type TaskDateFilter } from './taskDates';
import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
import { storePendingTaskTarget } from '$lib/taskNavigation';
import { appStore } from '$lib/app/appStore.svelte';
import {
  routeTaskDocumentMutation
} from './taskMutationGateway';
import type { CommittedMutationWarning } from '$lib/contracts/committedMutation';

export interface TaskItem {
  noteId: string;
  taskKey: string;
  taskId: string;
  notePath: string;
  fileName: string;
  noteTitle: string;
  sectionLabel: string | null;
  text: string;
  dueDate?: string | null;
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
  commitWarning?: CommittedMutationWarning;
}

const TASK_FILTER_STORAGE_KEY = 'gneauxghts.master-task-filter';

export class TaskListStore {
  filter = $state<TaskFilter>('all');
  dateFilter = $state<TaskDateFilter>('all');
  dueDateSort = $state(false);
  today = $state(localCalendarDate());

  get dateGroups(): TaskGroup[] {
    return this.groups.map((group) => {
      const displayTasks = group.displayTasks.filter((task) => matchesTaskDateFilter(task.text, task.completed, this.dateFilter, this.today));
      if (this.dueDateSort) displayTasks.sort((a, b) => (taskDueDate(a.text) ?? '99999').localeCompare(taskDueDate(b.text) ?? '99999'));
      return { ...group, displayTasks, displayCount: displayTasks.length };
    }).filter((group) => group.displayCount > 0);
  }
  showHidden = $state(false);
  groups = $state<TaskGroup[]>([]);
  togglingTaskKeys = $state<Record<string, boolean>>({});
  deletingTaskKeys = $state<Record<string, boolean>>({});
  mutatingNoteIds = $state<Record<string, boolean>>({});
  isLoading = $state(true);
  errorMessage = $state('');
  isReordering = $state(false);

  #activeRequest = 0;
  #projectionRevision = 0;
  #disposeInitialization: (() => void) | null = null;
  #lifetime = 0;
  #disposed = false;
  #groupRequests = new Map<string, number>();
  #reorderRequest = 0;

  #projectionTicket(noteId: string) {
    const request = (this.#groupRequests.get(noteId) ?? 0) + 1;
    this.#groupRequests.set(noteId, request);
    const lifetime = this.#lifetime;
    const view = this.#activeRequest;
    const { filter, showHidden } = this;
    return () => !this.#disposed && lifetime === this.#lifetime && view === this.#activeRequest &&
      filter === this.filter && showHidden === this.showHidden && this.#groupRequests.get(noteId) === request;
  }
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
    if (this.#disposed) return;
    const requestId = ++this.#activeRequest;
    const projectionRevision = this.#projectionRevision;

    if (!background) {
      this.isLoading = true;
    }

    try {
      const nextGroups = await invoke<TaskGroup[]>('list_tasks', {
        filter: this.filter,
        showHidden: this.showHidden
      });

      if (requestId !== this.#activeRequest) return;
      if (projectionRevision !== this.#projectionRevision) {
        void this.load({ background: true });
        return;
      }
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
    this.#projectionRevision += 1;
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
    if (this.#disposed) return;
    const admit = this.#projectionTicket(noteId);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('get_task_group', {
        noteId,
        ...this.#currentViewParams()
      });
      if (!admit()) return;
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      if (!admit()) return;
      console.error('Failed to refresh task group:', error);
      void this.load({ background: true });
    }
  }

  async toggleNoteCollapsed(group: TaskGroup) {
    if (this.#disposed || this.mutatingNoteIds[group.noteId]) return;
    this.#setNoteMutating(group.noteId, true);
    const admit = this.#projectionTicket(group.noteId);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_note_collapsed', {
        noteId: group.noteId,
        collapsed: !group.noteCollapsed,
        ...this.#currentViewParams()
      });
      if (!admit()) { await this.refreshGroup(group.noteId); return; }
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      if (!admit()) return;
      console.error('Failed to update collapsed note state:', error);
      this.errorMessage = 'Unable to save collapsed files.';
    } finally {
      this.#setNoteMutating(group.noteId, false);
    }
  }

  async setTaskHidden(task: TaskItem, hidden: boolean) {
    if (this.#disposed || this.mutatingNoteIds[task.noteId]) return;
    this.#setNoteMutating(task.noteId, true);
    const admit = this.#projectionTicket(task.noteId);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_task_hidden', {
        taskId: task.taskId,
        hidden,
        ...this.#currentViewParams()
      });
      if (!admit()) { await this.refreshGroup(task.noteId); return; }
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      if (!admit()) return;
      console.error('Failed to update hidden task state:', error);
      this.errorMessage = 'Unable to update hidden tasks.';
    } finally {
      this.#setNoteMutating(task.noteId, false);
    }
  }

  async #mutateTask(task: TaskItem, kind: 'toggle' | 'delete' | 'setDueDate', dueDate?: string | null) {
    if (this.#disposed) return;
    if (this.mutatingNoteIds[task.noteId]) {
      if (kind === 'setDueDate') throw new Error('This note is still saving. Try again.');
      return;
    }
    this.#setNoteMutating(task.noteId, true);
    const keys = kind === 'toggle' ? 'togglingTaskKeys' : kind === 'delete' ? 'deletingTaskKeys' : null;
    if (keys) this[keys] = { ...this[keys], [task.taskKey]: true };
    const lifetime = this.#lifetime;
    const alive = () => !this.#disposed && lifetime === this.#lifetime;
    const admit = this.#projectionTicket(task.noteId);
    const params = this.#currentViewParams();
    try {
      const routed = await routeTaskDocumentMutation({ kind, taskId: task.taskId, noteId: task.noteId, notePath: task.notePath,
        ...(kind === 'setDueDate' ? { dueDate: dueDate ?? null } : {}) } as Parameters<typeof routeTaskDocumentMutation>[0]);
      if (routed.status === 'applied-to-open-document') {
        if (alive()) await this.refreshGroup(task.noteId);
        return;
      }
      const command = kind === 'toggle' ? 'toggle_task' : kind === 'delete' ? 'delete_task' : 'set_task_due_date';
      const patch = await invoke<TaskListGroupPatch>(command, { taskId: task.taskId, ...params,
        ...(kind === 'setDueDate' ? { dueDate: dueDate ?? null } : {}) });
      if (!alive()) return;
      if (patch.commitWarning) {
        // Canonical success is never retried. Refresh completion owns clearing this status.
        this.errorMessage = `${kind === 'delete' ? 'Task deleted' : kind === 'setDueDate' ? 'Due date saved' : 'Task saved'}; the task list is waiting for synchronization.`;
        void this.load({ background: true });
      } else if (admit()) {
        this.#applyGroupPatch(patch);
        this.errorMessage = '';
      } else {
        await this.refreshGroup(task.noteId);
      }
    } catch (error) {
      if (alive()) this.errorMessage = kind === 'toggle' ? 'Unable to update task completion.' : kind === 'delete' ? 'Unable to delete task.' : 'Unable to update the due date.';
      if (kind === 'setDueDate') throw error;
    } finally {
      if (keys) { const next = { ...this[keys] }; delete next[task.taskKey]; this[keys] = next; }
      this.#setNoteMutating(task.noteId, false);
    }
  }

  toggleTask(task: TaskItem) { return this.#mutateTask(task, 'toggle'); }
  deleteTask(task: TaskItem) { return this.#mutateTask(task, 'delete'); }
  setDueDate(task: TaskItem, dueDate: string | null) { return this.#mutateTask(task, 'setDueDate', dueDate); }

  async setNoteHidden(group: TaskGroup, hidden: boolean) {
    if (this.#disposed || this.mutatingNoteIds[group.noteId]) return;
    this.#setNoteMutating(group.noteId, true);
    const admit = this.#projectionTicket(group.noteId);
    try {
      const groupPatch = await invoke<TaskListGroupPatch>('set_note_hidden', {
        noteId: group.noteId,
        hidden,
        ...this.#currentViewParams()
      });
      if (!admit()) { await this.refreshGroup(group.noteId); return; }
      this.#applyGroupPatch(groupPatch);
      this.errorMessage = '';
    } catch (error) {
      if (!admit()) return;
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
    if (this.isReordering || this.#disposed) return;
    const noteOrder = this.#buildNoteOrder();
    if (fromIndex < 0 || fromIndex >= noteOrder.length) return;
    if (toIndex < 0 || toIndex >= noteOrder.length) return;
    if (fromIndex === toIndex) return;

    const [movedNoteId] = noteOrder.splice(fromIndex, 1);
    if (!movedNoteId) return;
    noteOrder.splice(toIndex, 0, movedNoteId);

    const request = ++this.#reorderRequest;
    this.isReordering = true;
    const lifetime = this.#lifetime;
    const view = this.#activeRequest;
    const previousGroups = this.groups;
    const noteRank = new Map(noteOrder.map((noteId, index) => [noteId, index]));
    this.groups = [...previousGroups].sort(
      (left, right) =>
        (noteRank.get(left.noteId) ?? Number.MAX_SAFE_INTEGER) -
        (noteRank.get(right.noteId) ?? Number.MAX_SAFE_INTEGER)
    );

    const optimisticGroups = this.groups;
    const isCurrent = () => !this.#disposed && lifetime === this.#lifetime && request === this.#reorderRequest;
    try {
      await invoke('set_note_order', { noteIds: noteOrder });
      if (!isCurrent()) return;
      // Reads started before this commit may contain old persisted ranks.
      // The existing projection revision rejects those still in flight.
      this.#projectionRevision += 1;
      if (view !== this.#activeRequest || this.groups !== optimisticGroups) {
        // A read or group patch already published during the write. Refresh
        // the current view without replaying the committed order mutation.
        await this.load({ background: true });
        return;
      }
      this.errorMessage = '';
    } catch (error) {
      if (!isCurrent() || view !== this.#activeRequest) return;
      console.error('Failed to save note order:', error);
      // A checkbox or collapse can publish newer group data during the write.
      // Restore only ranks, retaining that data and any newly admitted groups.
      const previousRank = new Map(previousGroups.map((group, index) => [group.noteId, index]));
      this.groups = [...this.groups].sort((left, right) =>
        (previousRank.get(left.noteId) ?? Number.MAX_SAFE_INTEGER) -
        (previousRank.get(right.noteId) ?? Number.MAX_SAFE_INTEGER));
      this.errorMessage = 'Unable to save note order.';
    } finally {
      if (request === this.#reorderRequest) this.isReordering = false;
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

  initialize() {
    this.#disposeInitialization?.();
    this.#disposed = false;
    const lifetime = ++this.#lifetime;
    const disposeDay = subscribeCalendarDay((today) => { this.today = today; });
    const storedFilter = this.#readStoredTaskFilter();
    if (storedFilter) {
      this.filter = storedFilter;
    }

    void appStore.bootstrap().then(() => {
      if (this.#disposed || lifetime !== this.#lifetime) return;
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
    }).catch(() => {
      if (!this.#disposed && lifetime === this.#lifetime) this.errorMessage = 'Unable to subscribe to task updates.';
    });
    void this.load();

    const dispose = () => {
      disposeDay();
      if (lifetime !== this.#lifetime) return;
      this.#disposed = true;
      this.#lifetime += 1;
      this.#activeRequest += 1;
      this.#disposeNoteSaved?.();
      this.#disposeVaultNoteChanged?.();
      this.#disposeVaultChanged?.();
      this.#disposeNoteSaved = null;
      this.#disposeVaultNoteChanged = null;
      this.#disposeVaultChanged = null;
    };
    this.#disposeInitialization = dispose;
    return dispose;
  }
}

export function createTaskListStore() {
  return new TaskListStore();
}

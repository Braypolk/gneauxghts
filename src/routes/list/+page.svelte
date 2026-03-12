<script lang="ts">
  import { goto } from '$app/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import {
    ArrowDown,
    ArrowUp,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CornerDownRight,
    Circle,
    Eye,
    EyeOff,
    ExternalLink,
    RefreshCw
  } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { storePendingTaskTarget } from '$lib/taskNavigation';

  interface TaskItem {
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
  }

  interface TaskGroup {
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

  type TaskFilter = 'open' | 'completed' | 'all';

  const filterOptions = [
    { id: 'open', label: 'Open' },
    { id: 'completed', label: 'Completed' },
    { id: 'all', label: 'All tasks' }
  ] as const satisfies ReadonlyArray<{ id: TaskFilter; label: string }>;

  let filter = $state<TaskFilter>('open');
  let showHidden = $state(false);
  let tasks = $state<TaskItem[]>([]);
  let togglingTaskKeys = $state<Record<string, boolean>>({});
  let isLoading = $state(true);
  let errorMessage = $state('');
  let activeRequest = 0;

  const groupedTasks = $derived.by(() => {
    const groups = new Map<string, TaskGroup>();

    for (const task of tasks) {
      if (!showHidden && task.noteHidden) {
        continue;
      }

      const existingGroup = groups.get(task.notePath);
      if (existingGroup) {
        existingGroup.noteHidden = task.noteHidden;
        existingGroup.noteCollapsed = task.noteCollapsed;
        if (task.hidden) {
          existingGroup.hiddenCount += 1;
        } else {
          existingGroup.visibleCount += 1;
        }
        if (showHidden || !task.hidden) {
          existingGroup.displayTasks.push(task);
          existingGroup.displayCount += 1;
        }
        continue;
      }

      groups.set(task.notePath, {
        notePath: task.notePath,
        noteTitle: task.noteTitle,
        fileName: task.fileName,
        noteHidden: task.noteHidden,
        noteCollapsed: task.noteCollapsed,
        displayTasks: showHidden || !task.hidden ? [task] : [],
        hiddenCount: task.hidden ? 1 : 0,
        visibleCount: task.hidden ? 0 : 1,
        displayCount: showHidden || !task.hidden ? 1 : 0
      });
    }

    return Array.from(groups.values()).filter((group) => group.displayCount > 0);
  });

  const taskCountLabel = $derived.by(() => {
    const count = groupedTasks.reduce((sum, group) => sum + group.displayCount, 0);
    const noun = count === 1 ? 'task' : 'tasks';

    if (filter === 'open') return `${count} open ${noun}`;
    if (filter === 'completed') return `${count} completed ${noun}`;
    return `${count} total ${noun}`;
  });

  async function loadTasks({ background = false } = {}) {
    const requestId = ++activeRequest;

    if (!background) {
      isLoading = true;
    }

    try {
      const nextTasks = await invoke<TaskItem[]>('list_tasks', { filter });

      if (requestId !== activeRequest) return;
      tasks = nextTasks;
      errorMessage = '';
    } catch (error) {
      if (requestId !== activeRequest) return;
      console.error('Failed to load tasks:', error);
      errorMessage = 'Unable to load the master task list.';
    } finally {
      if (requestId === activeRequest) {
        isLoading = false;
      }
    }
  }

  function setFilter(nextFilter: TaskFilter) {
    if (filter === nextFilter) return;
    filter = nextFilter;
    void loadTasks({ background: tasks.length > 0 });
  }

  function refreshTasks() {
    void loadTasks({ background: tasks.length > 0 });
  }

  function toggleShowHidden() {
    showHidden = !showHidden;
  }

  async function toggleNoteCollapsed(group: TaskGroup) {
    const previousTasks = tasks;
    tasks = tasks.map((candidate) =>
      candidate.notePath === group.notePath ? { ...candidate, noteCollapsed: !group.noteCollapsed } : candidate
    );

    try {
      await invoke('set_note_collapsed', {
        notePath: group.notePath,
        collapsed: !group.noteCollapsed
      });
      errorMessage = '';
    } catch (error) {
      console.error('Failed to update collapsed note state:', error);
      tasks = previousTasks;
      errorMessage = 'Unable to save collapsed files.';
    }
  }

  async function setTaskHidden(task: TaskItem, hidden: boolean) {
    const previousTasks = tasks;
    tasks = tasks.map((candidate) => (candidate.taskKey === task.taskKey ? { ...candidate, hidden } : candidate));

    try {
      await invoke('set_task_hidden', {
        taskKey: task.taskKey,
        hidden
      });
      errorMessage = '';
    } catch (error) {
      console.error('Failed to update hidden task state:', error);
      tasks = previousTasks;
      errorMessage = 'Unable to update hidden tasks.';
    }
  }

  async function toggleTask(task: TaskItem) {
    togglingTaskKeys = {
      ...togglingTaskKeys,
      [task.taskKey]: true
    };

    try {
      await invoke('toggle_task', {
        notePath: task.notePath,
        lineNumber: task.lineNumber,
        taskText: task.text
      });
      errorMessage = '';
      await loadTasks({ background: true });
    } catch (error) {
      console.error('Failed to toggle task:', error);
      errorMessage = 'Unable to update task completion.';
    } finally {
      const nextTogglingTaskKeys = { ...togglingTaskKeys };
      delete nextTogglingTaskKeys[task.taskKey];
      togglingTaskKeys = nextTogglingTaskKeys;
    }
  }

  async function setNoteHidden(group: TaskGroup, hidden: boolean) {
    const previousTasks = tasks;
    tasks = tasks.map((candidate) =>
      candidate.notePath === group.notePath ? { ...candidate, noteHidden: hidden } : candidate
    );

    try {
      await invoke('set_note_hidden', {
        notePath: group.notePath,
        hidden
      });
      errorMessage = '';
    } catch (error) {
      console.error('Failed to update hidden note state:', error);
      tasks = previousTasks;
      errorMessage = 'Unable to update hidden files.';
    }
  }

  function buildNoteOrder() {
    const notePaths = [];
    const seen = new Set<string>();

    for (const task of tasks) {
      if (seen.has(task.notePath)) continue;
      seen.add(task.notePath);
      notePaths.push(task.notePath);
    }

    return notePaths;
  }

  function taskIndentStyle(depth: number) {
    return `margin-left: ${Math.min(depth, 6) * 1.1}rem;`;
  }

  async function moveNote(group: TaskGroup, direction: 'up' | 'down') {
    const noteOrder = buildNoteOrder();
    const currentIndex = noteOrder.indexOf(group.notePath);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= noteOrder.length) return;

    [noteOrder[currentIndex], noteOrder[targetIndex]] = [noteOrder[targetIndex], noteOrder[currentIndex]];

    const previousTasks = tasks;
    const noteRank = new Map(noteOrder.map((notePath, index) => [notePath, index]));
    tasks = [...tasks].sort((left, right) => {
      const leftRank = noteRank.get(left.notePath) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = noteRank.get(right.notePath) ?? Number.MAX_SAFE_INTEGER;

      return leftRank - rightRank || left.lineNumber - right.lineNumber || left.text.localeCompare(right.text);
    });

    try {
      await invoke('set_note_order', { notePaths: noteOrder });
      errorMessage = '';
    } catch (error) {
      console.error('Failed to save note order:', error);
      tasks = previousTasks;
      errorMessage = 'Unable to save note order.';
    }
  }

  async function openTask(task: TaskItem) {
    try {
      await invoke('open_note', { path: task.notePath });
      storePendingTaskTarget({
        notePath: task.notePath,
        text: task.text,
        lineNumber: task.lineNumber,
        sectionLabel: task.sectionLabel
      });
      await goto('/');
    } catch (error) {
      console.error('Failed to open task note:', error);
      errorMessage = `Unable to open ${task.noteTitle}.`;
    }
  }

  onMount(() => {
    void loadTasks();

    const handleWindowFocus = () => {
      void loadTasks({ background: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadTasks({ background: true });
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });
</script>

<div class="h-full w-full bg-[#f8f9fa] flex flex-col overflow-hidden">
  <main class="flex-1 min-h-0 overflow-hidden py-4">
    <section class="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
      <div class="border-b border-gray-200 px-8 py-6">
        <div class="flex flex-col gap-5">
          <div class="space-y-2">
            <p class="text-sm text-gray-500">{taskCountLabel}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="flex items-center gap-2 rounded-full bg-gray-100 p-1">
              {#each filterOptions as option}
                <button
                  type="button"
                  class={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    filter === option.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                  }`}
                  onclick={() => setFilter(option.id)}
                >
                  {option.label}
                </button>
              {/each}
            </div>

            <button
              type="button"
              class={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                showHidden
                  ? 'border-gray-300 bg-white text-gray-900'
                  : 'border-transparent bg-gray-100 text-gray-500 hover:text-gray-900'
              }`}
              onclick={toggleShowHidden}
            >
              {#if showHidden}
                <Eye class="h-4 w-4" />
                Hide hidden
              {:else}
                <EyeOff class="h-4 w-4" />
                Show hidden
              {/if}
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
              onclick={refreshTasks}
            >
              <RefreshCw class="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
        {#if isLoading}
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-dashed border-gray-200 bg-gray-50 px-6 text-sm font-medium text-gray-500">
            Building the task list
          </div>
        {:else if errorMessage}
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-red-200 bg-red-50 px-6 text-sm font-medium text-red-600">
            {errorMessage}
          </div>
        {:else if groupedTasks.length === 0}
          <div class="flex h-full flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-gray-200 bg-gray-50 px-6 text-center">
            <p class="text-lg font-medium text-gray-900">No matching tasks yet</p>
            <p class="mt-2 max-w-md text-sm text-gray-500">
              Add markdown checkboxes like <code class="rounded bg-white px-1.5 py-0.5 text-xs text-gray-700">- [ ]</code>
              or <code class="rounded bg-white px-1.5 py-0.5 text-xs text-gray-700">* [x]</code> inside any note.
            </p>
          </div>
        {:else}
          <div class="space-y-4">
            {#each groupedTasks as group, index}
              <section
                class={`overflow-hidden rounded-[1.35rem] border ${
                  group.noteHidden ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div class={`flex items-center gap-3 px-4 py-3 ${group.noteHidden ? 'bg-gray-50' : 'bg-white'}`}>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:text-gray-700"
                    onclick={() => void toggleNoteCollapsed(group)}
                  >
                    <span class="shrink-0 text-gray-400">
                      {#if group.noteCollapsed}
                        <ChevronRight class="h-4 w-4" />
                      {:else}
                        <ChevronDown class="h-4 w-4" />
                      {/if}
                    </span>

                    <span class="min-w-0 flex-1">
                      <span
                        class={`block truncate text-sm font-semibold ${group.noteHidden ? 'text-gray-500' : 'text-gray-900'}`}
                        title={group.noteTitle}
                      >
                        {group.noteTitle}
                      </span>
                      <span class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
                        <span>{group.displayCount} shown</span>
                        {#if group.hiddenCount > 0}
                          <span>{group.hiddenCount} hidden</span>
                        {/if}
                        {#if group.noteHidden}
                          <span>file hidden</span>
                        {/if}
                        {#if group.fileName !== group.noteTitle}
                          <span title={group.fileName}>{group.fileName}</span>
                        {/if}
                      </span>
                    </span>
                  </button>

                  <span class="shrink-0">
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35"
                        onclick={() => void moveNote(group, 'up')}
                        disabled={index === 0}
                        aria-label={`Move ${group.noteTitle} up`}
                      >
                        <ArrowUp class="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35"
                        onclick={() => void moveNote(group, 'down')}
                        disabled={index === groupedTasks.length - 1}
                        aria-label={`Move ${group.noteTitle} down`}
                      >
                        <ArrowDown class="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                        onclick={() => void setNoteHidden(group, !group.noteHidden)}
                      >
                        {#if group.noteHidden}
                          <Eye class="h-3.5 w-3.5" />
                          Unhide file
                        {:else}
                          <EyeOff class="h-3.5 w-3.5" />
                          Hide file
                        {/if}
                      </button>
                    </div>
                  </span>
                </div>

                {#if !group.noteCollapsed}
                  <div class="border-t border-gray-100 px-3 py-3">
                    <div class="space-y-2">
                      {#each group.displayTasks as task}
                        <div
                          class={`flex items-center gap-3 rounded-[1rem] border px-3 py-2 ${
                            task.hidden ? 'border-gray-100 bg-gray-50' : 'border-gray-200 bg-white'
                          }`}
                          style={taskIndentStyle(task.depth)}
                        >
                          {#if task.depth > 0}
                            <span class="shrink-0 text-gray-300">
                              <CornerDownRight class="h-3.5 w-3.5" />
                            </span>
                          {/if}

                          <button
                            type="button"
                            class="shrink-0 text-gray-400 transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-45"
                            onclick={() => void toggleTask(task)}
                            disabled={!!togglingTaskKeys[task.taskKey]}
                            aria-label={task.completed ? `Mark ${task.text} incomplete` : `Mark ${task.text} complete`}
                          >
                            {#if task.completed}
                              <CheckCircle2 class="h-4.5 w-4.5 text-emerald-500" />
                            {:else}
                              <Circle class="h-4.5 w-4.5 text-gray-400" />
                            {/if}
                          </button>

                          <span class="min-w-0 flex-1">
                            <span
                              class={`block truncate text-sm leading-5 ${
                                task.completed ? 'text-gray-400 line-through' : task.hidden ? 'text-gray-400' : 'text-gray-900'
                              }`}
                              title={task.text}
                            >
                              {task.text}
                            </span>
                          </span>

                          <span class="hidden shrink-0 items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400 md:inline-flex">
                            {#if task.sectionLabel}
                              <span class="max-w-32 truncate" title={task.sectionLabel}>{task.sectionLabel}</span>
                            {/if}
                          </span>

                          <div class="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                              onclick={() => openTask(task)}
                            >
                              <ExternalLink class="h-3.5 w-3.5" />
                              Open
                            </button>

                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                              onclick={() => void setTaskHidden(task, !task.hidden)}
                            >
                              {#if task.hidden}
                                <Eye class="h-3.5 w-3.5" />
                                Unhide
                              {:else}
                                <EyeOff class="h-3.5 w-3.5" />
                                Hide
                              {/if}
                            </button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </section>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </main>
</div>

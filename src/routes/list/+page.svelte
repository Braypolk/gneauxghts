<script lang="ts">
  import { goto } from '$app/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
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
    createdAtMillis: number;
    updatedAtMillis: number;
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
    { id: 'all', label: 'All tasks' },
    { id: 'open', label: 'Open' },
    { id: 'completed', label: 'Completed' }
  ] as const satisfies ReadonlyArray<{ id: TaskFilter; label: string }>;
  const TASK_FILTER_STORAGE_KEY = 'gneauxghts.master-task-filter';

  let filter = $state<TaskFilter>('all');
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
    persistTaskFilter(nextFilter);
    void loadTasks({ background: tasks.length > 0 });
  }

  function refreshTasks() {
    void loadTasks({ background: tasks.length > 0 });
  }

  function toggleShowHidden() {
    showHidden = !showHidden;
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
    const storedFilter = readStoredTaskFilter();
    if (storedFilter) {
      filter = storedFilter;
    }

    void loadTasks();
  });
</script>

<svelte:window onfocus={handleWindowFocus} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div class="h-full w-full bg-background text-foreground flex flex-col overflow-hidden">
  <main class="flex-1 min-h-0 overflow-hidden py-4">
    <section class="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm">
      <div class="border-b border-border px-8 py-6">
        <div class="flex flex-col gap-5">
          <div class="space-y-2">
            <p class="text-sm text-muted-foreground">{taskCountLabel}</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="flex items-center gap-2 rounded-full bg-muted p-1">
              {#each filterOptions as option}
                <button
                  type="button"
                  class={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    filter === option.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
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
                  ? 'border-border bg-card text-foreground'
                  : 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
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
              class="inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-muted px-6 text-sm font-medium text-muted-foreground">
            Building the task list
          </div>
        {:else if errorMessage}
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-destructive/25 bg-destructive/10 px-6 text-sm font-medium text-destructive">
            {errorMessage}
          </div>
        {:else if groupedTasks.length === 0}
          <div class="flex h-full flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-muted px-6 text-center">
            <p class="text-lg font-medium text-foreground">No matching tasks yet</p>
            <p class="mt-2 max-w-md text-sm text-muted-foreground">
              Add markdown checkboxes like <code class="rounded border border-border/70 bg-card px-1.5 py-0.5 text-xs text-foreground">- [ ]</code>
              or <code class="rounded border border-border/70 bg-card px-1.5 py-0.5 text-xs text-foreground">* [x]</code> inside any note.
            </p>
          </div>
        {:else}
          <div class="space-y-4">
            {#each groupedTasks as group, index}
              <section
                class={`overflow-hidden rounded-[1.35rem] border ${
                  group.noteHidden ? 'border-border bg-muted' : 'border-border bg-card'
                }`}
              >
                <div class={`flex items-center gap-3 px-4 py-3 ${group.noteHidden ? 'bg-muted' : 'bg-card'}`}>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:text-foreground"
                    onclick={() => void toggleNoteCollapsed(group)}
                  >
                    <span class="shrink-0 text-muted-foreground">
                      {#if group.noteCollapsed}
                        <ChevronRight class="h-4 w-4" />
                      {:else}
                        <ChevronDown class="h-4 w-4" />
                      {/if}
                    </span>

                    <span class="min-w-0 flex-1">
                      <span
                        class={`block truncate text-sm font-semibold ${group.noteHidden ? 'text-muted-foreground' : 'text-foreground'}`}
                        title={group.noteTitle}
                      >
                        {group.noteTitle}
                      </span>
                      <span class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
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
                        class="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-35"
                        onclick={() => void moveNote(group, 'up')}
                        disabled={index === 0}
                        aria-label={`Move ${group.noteTitle} up`}
                      >
                        <ArrowUp class="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-35"
                        onclick={() => void moveNote(group, 'down')}
                        disabled={index === groupedTasks.length - 1}
                        aria-label={`Move ${group.noteTitle} down`}
                      >
                        <ArrowDown class="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
                  <div class="border-t border-border/70 px-3 py-3">
                    <div class="space-y-2">
                      {#each group.displayTasks as task}
                        <div
                          class={`flex items-center gap-3 rounded-[1rem] border px-3 py-2 ${
                            task.hidden ? 'border-border/60 bg-muted/70' : 'border-border bg-card'
                          }`}
                          style={taskIndentStyle(task.depth)}
                        >
                          {#if task.depth > 0}
                            <span class="shrink-0 text-muted-foreground/55">
                              <CornerDownRight class="h-3.5 w-3.5" />
                            </span>
                          {/if}

                          <button
                            type="button"
                            class="shrink-0 text-muted-foreground transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-45"
                            onclick={() => void toggleTask(task)}
                            disabled={!!togglingTaskKeys[task.taskKey]}
                            aria-label={task.completed ? `Mark ${task.text} incomplete` : `Mark ${task.text} complete`}
                          >
                            {#if task.completed}
                              <CheckCircle2 class="h-4.5 w-4.5 text-emerald-500" />
                            {:else}
                              <Circle class="h-4.5 w-4.5 text-muted-foreground" />
                            {/if}
                          </button>

                          <span class="min-w-0 flex-1">
                            <span
                              class={`block truncate text-sm leading-5 ${
                                task.completed ? 'text-muted-foreground line-through' : task.hidden ? 'text-muted-foreground' : 'text-foreground'
                              }`}
                              title={task.text}
                            >
                              {task.text}
                            </span>
                            <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground">
                              {#if task.sectionLabel}
                                <span class="max-w-40 truncate" title={task.sectionLabel}>{task.sectionLabel}</span>
                              {/if}
                            </span>
                          </span>

                          <div class="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                              onclick={() => openTask(task)}
                            >
                              <ExternalLink class="h-3.5 w-3.5" />
                              Open
                            </button>

                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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

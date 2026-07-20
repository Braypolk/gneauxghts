<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Circle,
    CornerDownRight,
    Eye,
    EyeOff,
    ExternalLink,
    GripVertical,
    RefreshCw,
    Trash2
  } from '@lucide/svelte';
  import {
    createTaskListStore,
    type TaskFilter,
    type TaskGroup,
    type TaskItem
  } from '$lib/features/tasks/taskListStore.svelte';
  import SearchBar from '$lib/ui/search/SearchBar.svelte';
  import SearchDock from '$lib/ui/search/SearchDock.svelte';
  import { textMatchesSearch } from '$lib/ui/search/searchMatch';

  const filterOptions = [
    { id: 'all', label: 'All tasks', shortLabel: 'All' },
    { id: 'open', label: 'Open', shortLabel: 'Open' },
    { id: 'completed', label: 'Completed', shortLabel: 'Done' }
  ] as const satisfies ReadonlyArray<{ id: TaskFilter; label: string; shortLabel: string }>;

  const taskList = createTaskListStore();
  let searchQuery = $state('');
  let matchCase = $state(false);
  let matchWholeWord = $state(false);

  const normalizedSearchQuery = $derived(searchQuery.trim());
  const searchOptions = $derived({ matchCase, matchWholeWord });
  const visibleTaskGroups = $derived.by(() => {
    if (normalizedSearchQuery === '') return taskList.groups;

    return taskList.groups
      .map((group): TaskGroup | null => {
        const noteMatches = [group.noteTitle, group.fileName].some((value) =>
          textMatchesSearch(value, normalizedSearchQuery, searchOptions)
        );
        const displayTasks = group.displayTasks.filter((task) => taskMatchesSearch(task, normalizedSearchQuery));

        if (!noteMatches && displayTasks.length === 0) return null;

        return {
          ...group,
          displayTasks: noteMatches ? group.displayTasks : displayTasks,
          displayCount: noteMatches ? group.displayCount : displayTasks.length
        };
      })
      .filter((group): group is TaskGroup => group !== null);
  });

  const taskCountLabel = $derived.by(() => {
    const count = visibleTaskGroups.reduce((sum, group) => sum + group.displayCount, 0);
    const noun = count === 1 ? 'task' : 'tasks';

    if (normalizedSearchQuery !== '') return `${count} matching ${noun}`;
    if (taskList.filter === 'open') return `${count} open ${noun}`;
    if (taskList.filter === 'completed') return `${count} completed ${noun}`;
    return `${count} total ${noun}`;
  });

  function taskMatchesSearch(task: TaskItem, query: string) {
    return [task.text, task.noteTitle, task.fileName, task.sectionLabel ?? ''].some((value) =>
      textMatchesSearch(value, query, searchOptions)
    );
  }

  function taskIndentStyle(depth: number) {
    return `--task-indent: ${Math.min(depth, 6)};`;
  }

  let dragSrcNoteId = $state<string | null>(null);
  let dragOverNoteId = $state<string | null>(null);

  function getGroupIndex(noteId: string) {
    return taskList.groups.findIndex((group) => group.noteId === noteId);
  }

  function handleDragStart(noteId: string) {
    dragSrcNoteId = noteId;
  }

  function handleDragOver(event: DragEvent, noteId: string) {
    event.preventDefault();
    if (dragSrcNoteId === null || dragSrcNoteId === noteId) {
      dragOverNoteId = null;
      return;
    }
    dragOverNoteId = noteId;
  }

  function handleDrop(event: DragEvent, noteId: string) {
    event.preventDefault();
    if (dragSrcNoteId !== null && dragSrcNoteId !== noteId) {
      const sourceIndex = getGroupIndex(dragSrcNoteId);
      const targetIndex = getGroupIndex(noteId);

      if (sourceIndex !== -1 && targetIndex !== -1) {
        void taskList.reorderNote(sourceIndex, targetIndex);
      }
    }
    dragSrcNoteId = null;
    dragOverNoteId = null;
  }

  function handleDragEnd() {
    dragSrcNoteId = null;
    dragOverNoteId = null;
  }

  onMount(() => {
    return taskList.initialize();
  });

  afterNavigate(() => {
    void taskList.load({ background: taskList.groups.length > 0 });
  });
</script>

<svelte:window onfocus={taskList.handleWindowFocus} />
<svelte:document onvisibilitychange={taskList.handleVisibilityChange} />

<div class="relative h-full w-full bg-background text-foreground flex flex-col overflow-hidden">
  <main class="relative mx-auto flex w-full flex-1 flex-col justify-center overflow-hidden pb-0 sm:pb-4">
    <section class="relative mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden border-y border-border bg-card shadow-sm sm:rounded-4xl sm:border">
      <div class="border-b border-border px-3 py-3 sm:px-8 sm:py-6">
        <div class="flex flex-col gap-3 sm:gap-5">
          <div class="space-y-2">
            <p class="text-sm text-muted-foreground">{taskCountLabel}</p>
          </div>

          <div class="flex items-center gap-2">
            <div
              class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-full bg-muted p-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden"
              role="toolbar"
              aria-label="Task filters"
            >
              {#each filterOptions as option (option.id)}
                <button
                  type="button"
                  class={`min-h-10 shrink-0 rounded-full px-3 py-2 text-sm font-medium transition-colors touch-manipulation sm:min-h-0 sm:px-4 ${
                    taskList.filter === option.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onclick={() => taskList.setActiveFilter(option.id)}
                  aria-label={option.label}
                  aria-pressed={taskList.filter === option.id}
                >
                  <span class="sm:hidden" aria-hidden="true">{option.shortLabel}</span>
                  <span class="hidden sm:inline" aria-hidden="true">{option.label}</span>
                </button>
              {/each}
            </div>

            <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                class={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors touch-manipulation sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 sm:text-sm sm:font-medium ${
                  taskList.showHidden
                    ? 'border-border bg-card text-foreground'
                    : 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                onclick={taskList.toggleShowHidden}
                aria-label={taskList.showHidden ? 'Hide hidden tasks' : 'Show hidden tasks'}
                title={taskList.showHidden ? 'Hide hidden' : 'Show hidden'}
              >
                {#if taskList.showHidden}
                  <Eye class="h-4 w-4" />
                {:else}
                  <EyeOff class="h-4 w-4" />
                {/if}
                <span class="hidden sm:inline">{taskList.showHidden ? 'Hide hidden' : 'Show hidden'}</span>
              </button>

              <button
                type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors touch-manipulation hover:bg-accent hover:text-accent-foreground sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2 sm:text-sm sm:font-medium"
                onclick={taskList.refresh}
                aria-label="Refresh task list"
                title="Refresh"
              >
                <RefreshCw class="h-4 w-4" />
                <span class="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        class="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-6 sm:pb-28 sm:pt-4 [-webkit-overflow-scrolling:touch]"
      >
        {#if taskList.isLoading}
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-muted px-6 text-sm font-medium text-muted-foreground">
            Building the task list
          </div>
        {:else if taskList.errorMessage}
          <div class="flex h-full items-center justify-center rounded-[1.5rem] border border-destructive/25 bg-destructive/10 px-6 text-sm font-medium text-destructive">
            {taskList.errorMessage}
          </div>
        {:else if visibleTaskGroups.length === 0}
          <div class="flex h-full flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-muted px-6 text-center">
            <p class="text-balance text-lg font-medium text-foreground">
              {normalizedSearchQuery === '' ? 'No matching tasks yet' : 'No tasks found'}
            </p>
            <p class="mt-2 max-w-md text-pretty text-sm text-muted-foreground">
              {#if normalizedSearchQuery === ''}
                Add markdown checkboxes like <code class="rounded border border-border/70 bg-card px-1.5 py-0.5 text-xs text-foreground">- [ ]</code>
                or <code class="rounded border border-border/70 bg-card px-1.5 py-0.5 text-xs text-foreground">* [x]</code> inside any note.
              {:else}
                Try a different task, note, file, or section name.
              {/if}
            </p>
          </div>
        {:else}
          <div class="space-y-3 sm:space-y-4">
            {#each visibleTaskGroups as group (group.noteId)}
              <section
                class={`task-note-group overflow-hidden rounded-[1.2rem] border sm:rounded-[1.35rem] ${
                  group.noteHidden ? 'border-border bg-muted' : 'border-border bg-card'
                } ${dragSrcNoteId === group.noteId ? 'opacity-50' : ''} ${dragOverNoteId === group.noteId && dragSrcNoteId !== group.noteId ? 'ring-2 ring-primary/50' : ''}`}
                role="group"
                draggable={!taskList.mutatingNoteIds[group.noteId]}
                ondragstart={(e) => {
                  const under = document.elementFromPoint(e.clientX, e.clientY);
                  if (!under?.closest('[data-drag-handle]')) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer?.setData('text/plain', group.noteId);
                  e.dataTransfer!.effectAllowed = 'move';
                  handleDragStart(group.noteId);
                }}
                ondragover={(e) => handleDragOver(e, group.noteId)}
                ondrop={(e) => handleDrop(e, group.noteId)}
                ondragend={handleDragEnd}
              >
                <div class={`flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 ${group.noteHidden ? 'bg-muted' : 'bg-card'}`}>
                  <span
                    data-drag-handle
                    class="task-drag-handle shrink-0 cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
                    role="button"
                    tabindex="0"
                    aria-label="Drag to reorder"
                  >
                    <GripVertical class="h-4 w-4" />
                  </span>

                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors touch-manipulation hover:text-foreground disabled:cursor-wait disabled:opacity-60 sm:gap-3"
                    onclick={() => void taskList.toggleNoteCollapsed(group)}
                    disabled={!!taskList.mutatingNoteIds[group.noteId]}
                  >
                    <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground sm:h-auto sm:w-auto">
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
                      <span class="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:mt-1 sm:gap-x-3 sm:tracking-[0.18em]">
                        <span>{group.displayCount} shown</span>
                        {#if group.hiddenCount > 0}
                          <span>{group.hiddenCount} hidden</span>
                        {/if}
                        {#if group.noteHidden}
                          <span>file hidden</span>
                        {/if}
                        {#if group.fileName !== group.noteTitle}
                          <span class="max-w-[10rem] truncate sm:max-w-none" title={group.fileName}>{group.fileName}</span>
                        {/if}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors touch-manipulation hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-45 sm:h-auto sm:w-auto sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-xs sm:font-medium"
                    onclick={() => void taskList.setNoteHidden(group, !group.noteHidden)}
                    disabled={!!taskList.mutatingNoteIds[group.noteId]}
                    aria-label={group.noteHidden ? 'Unhide file' : 'Hide file'}
                    title={group.noteHidden ? 'Unhide file' : 'Hide file'}
                  >
                    {#if group.noteHidden}
                      <Eye class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    {:else}
                      <EyeOff class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    {/if}
                    <span class="hidden sm:inline">{group.noteHidden ? 'Unhide file' : 'Hide file'}</span>
                  </button>
                </div>

                {#if !group.noteCollapsed}
                  <div class="border-t border-border/70 px-1.5 py-1.5 sm:px-3 sm:py-3">
                    <div class="space-y-1.5 sm:space-y-2">
                      {#each group.displayTasks as task (task.taskKey)}
                        <div
                          class={`task-row flex items-start gap-1 rounded-[0.9rem] border px-1.5 py-1 sm:items-center sm:gap-3 sm:rounded-[1rem] sm:px-3 sm:py-2 ${
                            task.hidden ? 'border-border/60 bg-muted/70' : 'border-border bg-card'
                          }`}
                          style={taskIndentStyle(task.depth)}
                        >
                          {#if task.depth > 0}
                            <span class="mt-3 shrink-0 text-muted-foreground/55 sm:mt-0">
                              <CornerDownRight class="h-3.5 w-3.5" />
                            </span>
                          {/if}

                          <button
                            type="button"
                            class="inline-flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground transition-opacity touch-manipulation hover:opacity-80 disabled:cursor-wait disabled:opacity-45 sm:h-auto sm:w-auto"
                            onclick={() => void taskList.toggleTask(task)}
                            disabled={!!taskList.togglingTaskKeys[task.taskKey] || !!taskList.mutatingNoteIds[group.noteId]}
                            aria-label={task.completed ? `Mark ${task.text} incomplete` : `Mark ${task.text} complete`}
                          >
                            {#if task.completed}
                              <CheckCircle2 class="h-5 w-5 text-emerald-500 sm:h-[1.125rem] sm:w-[1.125rem]" />
                            {:else}
                              <Circle class="h-5 w-5 text-muted-foreground sm:h-[1.125rem] sm:w-[1.125rem]" />
                            {/if}
                          </button>

                          <div class="flex min-w-0 flex-1 items-start gap-0.5 sm:items-center sm:gap-3">
                            <span class="min-w-0 flex-1 py-2.5 sm:py-0">
                              <span
                                class={`block text-pretty text-sm leading-5 ${
                                  task.completed ? 'text-muted-foreground line-through' : task.hidden ? 'text-muted-foreground' : 'text-foreground'
                                }`}
                              >
                                {task.text}
                              </span>
                              {#if task.sectionLabel}
                                <span class="mt-0.5 block text-pretty text-[11px] font-medium text-muted-foreground">
                                  {task.sectionLabel}
                                </span>
                              {/if}
                            </span>

                            <div class="flex shrink-0 items-center self-start sm:self-auto">
                              <button
                                type="button"
                                class="inline-flex h-11 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors touch-manipulation hover:bg-accent hover:text-accent-foreground sm:h-auto sm:w-auto sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-xs sm:font-medium"
                                onclick={() => taskList.openTask(task)}
                                aria-label={`Open task: ${task.text}`}
                                title="Open"
                              >
                                <ExternalLink class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                                <span class="hidden sm:inline">Open</span>
                              </button>

                              <button
                                type="button"
                                class="inline-flex h-11 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors touch-manipulation hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-45 sm:h-auto sm:w-auto sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-xs sm:font-medium"
                                onclick={() => void taskList.setTaskHidden(task, !task.hidden)}
                                disabled={!!taskList.mutatingNoteIds[group.noteId]}
                                aria-label={task.hidden ? `Unhide task: ${task.text}` : `Hide task: ${task.text}`}
                                title={task.hidden ? 'Unhide' : 'Hide'}
                              >
                                {#if task.hidden}
                                  <Eye class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                                {:else}
                                  <EyeOff class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                                {/if}
                                <span class="hidden sm:inline">{task.hidden ? 'Unhide' : 'Hide'}</span>
                              </button>

                              <button
                                type="button"
                                class="inline-flex h-11 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors touch-manipulation hover:bg-destructive/15 hover:text-destructive disabled:cursor-wait disabled:opacity-45 sm:h-auto sm:w-auto sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-xs sm:font-medium"
                                onclick={() => void taskList.deleteTask(task)}
                                disabled={!!taskList.deletingTaskKeys[task.taskKey] || !!taskList.mutatingNoteIds[group.noteId]}
                                aria-label={`Delete task: ${task.text}`}
                                title="Delete"
                              >
                                <Trash2 class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                                <span class="hidden sm:inline">Delete</span>
                              </button>
                            </div>
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

      <div
        class="list-search-backdrop pointer-events-none absolute inset-x-0 bottom-0 z-20 min-h-12 rounded-none bg-card/70 backdrop-blur-md sm:rounded-2xl"
      ></div>

      <SearchDock insetVariable="--list-search-bottom-inset">
        <SearchBar
          value={searchQuery}
          placeholder="Find tasks"
          ariaLabel="Search tasks"
          matchCase={matchCase}
          matchWholeWord={matchWholeWord}
          showMatchOptions={true}
          shortcut={{ enabled: true }}
          onValueChange={(value) => {
            searchQuery = value;
          }}
          onMatchCaseChange={(enabled) => {
            matchCase = enabled;
          }}
          onMatchWholeWordChange={(enabled) => {
            matchWholeWord = enabled;
          }}
        />
      </SearchDock>
    </section>
  </main>
</div>

<style>
  .list-search-backdrop {
    padding-top: 0.5rem;
    padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));
    mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%);
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
  }

  .task-row {
    margin-left: calc(var(--task-indent, 0) * 0.65rem);
  }

  /* HTML5 drag reorder is pointer-first; hide the handle on touch. */
  .task-drag-handle {
    display: none;
  }

  @media (pointer: fine) {
    .task-drag-handle {
      display: inline-flex;
    }
  }

  @media (min-width: 640px) {
    .list-search-backdrop {
      padding-top: 1rem;
      padding-bottom: 1rem;
    }

    .task-row {
      margin-left: calc(var(--task-indent, 0) * 1.1rem);
    }
  }
</style>

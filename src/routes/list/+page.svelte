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
    { id: 'all', label: 'All tasks' },
    { id: 'open', label: 'Open' },
    { id: 'completed', label: 'Completed' }
  ] as const satisfies ReadonlyArray<{ id: TaskFilter; label: string }>;

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
    return `margin-left: ${Math.min(depth, 6) * 1.1}rem;`;
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
      <div class="border-b border-border px-4 py-4 sm:px-8 sm:py-6">
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
                    taskList.filter === option.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onclick={() => taskList.setActiveFilter(option.id)}
                >
                  {option.label}
                </button>
              {/each}
            </div>

            <button
              type="button"
              class={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                taskList.showHidden
                  ? 'border-border bg-card text-foreground'
                  : 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
              onclick={taskList.toggleShowHidden}
            >
              {#if taskList.showHidden}
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
              onclick={taskList.refresh}
            >
              <RefreshCw class="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-24 pt-4 sm:px-6 sm:pb-28">
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
            <p class="text-lg font-medium text-foreground">
              {normalizedSearchQuery === '' ? 'No matching tasks yet' : 'No tasks found'}
            </p>
            <p class="mt-2 max-w-md text-sm text-muted-foreground">
              {#if normalizedSearchQuery === ''}
                Add markdown checkboxes like <code class="rounded border border-border/70 bg-card px-1.5 py-0.5 text-xs text-foreground">- [ ]</code>
                or <code class="rounded border border-border/70 bg-card px-1.5 py-0.5 text-xs text-foreground">* [x]</code> inside any note.
              {:else}
                Try a different task, note, file, or section name.
              {/if}
            </p>
          </div>
        {:else}
          <div class="space-y-4">
            {#each visibleTaskGroups as group, index}
              <section
                class={`overflow-hidden rounded-[1.35rem] border ${
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
                <div class={`flex items-center gap-3 px-4 py-3 ${group.noteHidden ? 'bg-muted' : 'bg-card'}`}>
                  <span
                    data-drag-handle
                    class="shrink-0 cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
                    role="button"
                    tabindex="0"
                    aria-label="Drag to reorder"
                  >
                    <GripVertical class="h-4 w-4" />
                  </span>

                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                    onclick={() => void taskList.toggleNoteCollapsed(group)}
                    disabled={!!taskList.mutatingNoteIds[group.noteId]}
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
                        class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-45"
                        onclick={() => void taskList.setNoteHidden(group, !group.noteHidden)}
                        disabled={!!taskList.mutatingNoteIds[group.noteId]}
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
                            onclick={() => void taskList.toggleTask(task)}
                            disabled={!!taskList.togglingTaskKeys[task.taskKey] || !!taskList.mutatingNoteIds[group.noteId]}
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
                              onclick={() => taskList.openTask(task)}
                            >
                              <ExternalLink class="h-3.5 w-3.5" />
                              Open
                            </button>

                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-45"
                              onclick={() => void taskList.setTaskHidden(task, !task.hidden)}
                              disabled={!!taskList.mutatingNoteIds[group.noteId]}
                            >
                              {#if task.hidden}
                                <Eye class="h-3.5 w-3.5" />
                                Unhide
                              {:else}
                                <EyeOff class="h-3.5 w-3.5" />
                                Hide
                              {/if}
                            </button>

                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:cursor-wait disabled:opacity-45"
                              onclick={() => void taskList.deleteTask(task)}
                              disabled={!!taskList.deletingTaskKeys[task.taskKey] || !!taskList.mutatingNoteIds[group.noteId]}
                              aria-label={`Delete task: ${task.text}`}
                            >
                              <Trash2 class="h-3.5 w-3.5" />
                              Delete
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
    padding-bottom: 0.5rem;
    mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%);
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
  }

  @media (min-width: 640px) {
    .list-search-backdrop {
      padding-top: 1rem;
      padding-bottom: 1rem;
    }
  }
</style>

<script lang="ts">
  import {
    ArrowLeft,
    ArrowRight,
    Check,
    ChevronLeft,
    ChevronRight,
    Circle,
    Clock3,
    FileText,
    Inbox,
    MessageSquare,
    PanelRight,
    Search,
    Send,
    X
  } from '@lucide/svelte';

  type Variant = 'overlay' | 'dock' | 'sidecar';
  type Mode = 'focus' | 'tasks';
  type WorkKind = 'review' | 'task' | 'job';
  type DrawerTab = 'review' | 'discuss';

  interface FocusItem {
    id: string;
    kind: WorkKind;
    title: string;
    description: string;
    source: string;
    section: string;
    timing: string;
    excerpt: string;
    outcome: string;
    action: string;
    done: boolean;
  }

  interface GlobalTask {
    id: string;
    text: string;
    note: string;
    section: string;
    timing: string;
    completed: boolean;
  }

  let { variant }: { variant: Variant } = $props();

  const concept = $derived(variant === 'overlay'
    ? { number: '1', name: 'The slide-over', line: 'Context stays quiet until an action asks for it.' }
    : variant === 'dock'
      ? { number: '2', name: 'The working dock', line: 'The task and its working context share the same surface.' }
      : { number: '3', name: 'The context edge', line: 'A narrow edge keeps depth nearby without taking over.' });

  let mode = $state<Mode>('focus');
  let activeId = $state('focus-review');
  let drawerOpen = $state(false);
  let drawerInitialized = $state(false);
  let drawerTab = $state<DrawerTab>('review');
  let query = $state('');
  let composer = $state('');
  let notice = $state('');
  let keptChanges = $state<string[]>([]);

  $effect(() => {
    if (!drawerInitialized) {
      drawerOpen = variant === 'dock';
      drawerInitialized = true;
    }
  });

  let focusItems = $state<FocusItem[]>([
    {
      id: 'focus-review', kind: 'review', title: 'Turn the weekly review into something useful',
      description: 'Three loose decisions surfaced across four notes. Two can become durable tasks; the third already exists.',
      source: 'Weekly review', section: 'Friday review', timing: 'Ready 8 minutes ago',
      excerpt: 'The shared vault still needs an explicit boundary between settings that travel with it and settings that belong to one Mac.',
      outcome: 'Decide which two proposed changes belong in their source notes.', action: 'Review changes', done: false
    },
    {
      id: 'focus-share', kind: 'task', title: 'Outline the sharing setup for a second Mac',
      description: 'Set the first-release boundary before implementation starts, while the constraints from the research chat are still fresh.',
      source: 'Gneauxghts roadmap', section: 'Multi-device', timing: 'Due today',
      excerpt: 'Keep device identity explicit. Prefer recoverable conflicts over silent last-writer-wins behavior.',
      outcome: 'A short setup sequence with ownership, recovery, and conflict behavior named.', action: 'Open note', done: false
    },
    {
      id: 'focus-kylie', kind: 'task', title: 'Send Kylie the revised outline',
      description: 'The outline is ready. The only remaining choice is whether to call out the audience-scope question now or hold it for the follow-up.',
      source: 'Meeting with Kylie', section: 'Follow-ups', timing: 'Tomorrow',
      excerpt: 'Mention the open question directly instead of hiding it in the supporting notes.',
      outcome: 'A clean handoff that makes the one unresolved choice visible.', action: 'Continue writing', done: false
    },
    {
      id: 'focus-job', kind: 'job', title: 'Decide what Project pulse can watch',
      description: 'Two linked notes moved outside the folder this watcher can currently read. It is paused until the boundary is explicit.',
      source: 'Project pulse', section: 'Scope', timing: 'Paused 2 hours ago',
      excerpt: 'Widening scope changes what future runs may read. The job will not resume on its own.',
      outcome: 'Choose the two additional notes or leave the watcher intentionally narrow.', action: 'Adjust scope', done: false
    }
  ]);

  let globalTasks = $state<GlobalTask[]>([
    { id: 'global-share', text: 'Outline the sharing setup for a second Mac', note: 'Gneauxghts roadmap', section: 'Multi-device', timing: 'Today', completed: false },
    { id: 'global-test', text: 'Test the shared vault on the MacBook', note: 'Gneauxghts roadmap', section: 'Test plan', timing: 'Today', completed: false },
    { id: 'global-kylie', text: 'Send Kylie the revised outline', note: 'Meeting with Kylie', section: 'Follow-ups', timing: 'Tomorrow', completed: false },
    { id: 'global-conflict', text: 'Choose a conflict-resolution policy', note: 'Mac sharing', section: 'Open questions', timing: 'This week', completed: false },
    { id: 'global-release', text: 'Write down the release checklist', note: 'Gneauxghts roadmap', section: 'Ship', timing: 'Complete', completed: true }
  ]);

  const activeItem = $derived(focusItems.find((item) => item.id === activeId) ?? focusItems[0]);
  const activeIndex = $derived(focusItems.findIndex((item) => item.id === activeId));
  const filteredTasks = $derived(globalTasks.filter((task) => `${task.text} ${task.note} ${task.section}`.toLowerCase().includes(query.toLowerCase())));

  function labelFor(kind: WorkKind) {
    return kind === 'review' ? 'Review' : kind === 'job' ? 'Decision' : 'Task';
  }

  function chooseItem(id: string) {
    activeId = id;
    notice = '';
    if (variant === 'dock') drawerOpen = true;
  }

  function openWorkspace(tab: DrawerTab) {
    drawerTab = tab;
    drawerOpen = true;
    notice = '';
  }

  function finishCurrent() {
    focusItems = focusItems.map((item) => item.id === activeId ? { ...item, done: true } : item);
    const next = focusItems.find((item, index) => index > activeIndex && !item.done);
    notice = 'Resolved. The path moved forward.';
    if (next) activeId = next.id;
  }

  function toggleGlobalTask(id: string) {
    globalTasks = globalTasks.map((task) => task.id === id ? { ...task, completed: !task.completed } : task);
  }

  function keepChange(id: string) {
    keptChanges = keptChanges.includes(id) ? keptChanges.filter((changeId) => changeId !== id) : [...keptChanges, id];
  }

  function sendMessage() {
    if (!composer.trim()) return;
    notice = `Added to the discussion: “${composer.trim()}”`;
    composer = '';
  }
</script>

<main class="mx-auto h-full w-full max-w-6xl px-0 pb-0 sm:px-4 sm:pb-4">
  <section class="flex h-full flex-col overflow-hidden border-y border-border bg-card sm:rounded-[1.75rem] sm:border">
    <header class="flex shrink-0 items-end justify-between gap-5 border-b border-border px-5 pb-4 pt-4 sm:px-7">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 class="text-xl font-semibold tracking-tight">Work</h1>
          <span class="text-xs text-muted-foreground">Concept {concept.number} · {concept.name}</span>
        </div>
        <p class="mt-1 truncate text-sm text-muted-foreground">{concept.line}</p>
      </div>
      <nav class="flex shrink-0 items-center gap-5" aria-label="Work modes">
        <button class={`border-b pb-1 text-sm ${mode === 'focus' ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`} onclick={() => mode = 'focus'}>Focus</button>
        <button class={`border-b pb-1 text-sm ${mode === 'tasks' ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`} onclick={() => mode = 'tasks'}>All tasks <span class="ml-1 text-xs text-muted-foreground">4</span></button>
      </nav>
    </header>

    {#if mode === 'focus'}
      <div class={`relative grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-300 ${variant === 'overlay' ? 'lg:grid-cols-[14.5rem_minmax(0,1fr)]' : variant === 'dock' ? (drawerOpen ? 'lg:grid-cols-[14.5rem_minmax(0,1fr)_22rem]' : 'lg:grid-cols-[14.5rem_minmax(0,1fr)_3.75rem]') : (drawerOpen ? 'lg:grid-cols-[12.5rem_minmax(0,1fr)_20rem]' : 'lg:grid-cols-[12.5rem_minmax(0,1fr)_7.5rem]')}`}>
        <nav class="min-h-0 overflow-y-auto border-b border-border bg-muted/15 lg:border-b-0 lg:border-r" aria-label="Focus path">
          <div class="px-5 pb-3 pt-5">
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Your path</p>
            <p class="mt-1 text-xs text-muted-foreground">One piece at a time</p>
          </div>
          <ol class="px-3 pb-5">
            {#each focusItems as item, index (item.id)}
              <li class="relative">
                {#if index < focusItems.length - 1}<span class="absolute bottom-0 left-[1.14rem] top-10 w-px bg-border"></span>{/if}
                <button
                  class={`relative flex w-full gap-3 rounded-xl px-2 py-3 text-left transition-colors ${item.id === activeId ? 'bg-background shadow-sm ring-1 ring-border/60' : 'hover:bg-background/60'}`}
                  onclick={() => chooseItem(item.id)}
                >
                  <span class={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${item.id === activeId ? 'border-foreground bg-foreground text-background' : item.done ? 'border-emerald-500 bg-card text-emerald-500' : 'border-border bg-card text-muted-foreground'}`}>{#if item.done}<Check class="h-3.5 w-3.5" />{:else}{index + 1}{/if}</span>
                  <span class="min-w-0 pt-0.5">
                    <span class="block text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{labelFor(item.kind)} · {item.timing}</span>
                    <span class={`mt-1 line-clamp-2 block text-sm font-medium leading-5 ${item.done ? 'text-muted-foreground line-through' : ''}`}>{item.title}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ol>
        </nav>

        <section class="min-h-0 overflow-y-auto px-6 py-7 sm:px-10 lg:px-12 lg:py-10">
          <div class="mx-auto flex min-h-full max-w-2xl flex-col justify-center">
            <button class="flex w-fit items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground" onclick={() => notice = `Opening ${activeItem.source}`}>
              <FileText class="h-3.5 w-3.5" /> {activeItem.source} <span class="text-border">/</span> {activeItem.section}
            </button>

            <div class="mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.17em] text-muted-foreground">
              {#if activeItem.kind === 'review'}<Inbox class="h-3.5 w-3.5" />{:else if activeItem.kind === 'job'}<Clock3 class="h-3.5 w-3.5" />{:else}<Circle class="h-3.5 w-3.5" />{/if}
              {labelFor(activeItem.kind)} · {activeItem.timing}
            </div>
            <h2 class="mt-3 text-3xl font-semibold leading-[1.08] tracking-tight sm:text-4xl">{activeItem.title}</h2>
            <p class="mt-4 text-base leading-7 text-muted-foreground">{activeItem.description}</p>

            <div class="mt-7 grid border-y border-border sm:grid-cols-[5.5rem_minmax(0,1fr)]">
              <p class="py-4 text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground sm:border-r sm:pr-4">From note</p>
              <blockquote class="py-4 text-sm leading-6 sm:pl-5">“{activeItem.excerpt}”</blockquote>
              <p class="border-t border-border py-4 text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground sm:border-r sm:pr-4">Done when</p>
              <p class="border-t border-border py-4 text-sm leading-6 sm:pl-5">{activeItem.outcome}</p>
            </div>

            <div class="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <button class="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background hover:opacity-90" onclick={() => openWorkspace('review')}>{activeItem.action} <ArrowRight class="h-4 w-4" /></button>
              <button class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" onclick={() => openWorkspace('discuss')}><MessageSquare class="h-4 w-4" /> Discuss</button>
              <button class="text-sm text-muted-foreground hover:text-foreground" onclick={finishCurrent}>Mark resolved</button>
            </div>
            {#if notice}<p class="mt-4 text-sm text-muted-foreground" aria-live="polite">{notice}</p>{/if}
          </div>
        </section>

        {#if variant === 'overlay'}
          {#if drawerOpen}
            <button class="absolute inset-0 z-20 bg-background/45 backdrop-blur-[1px] lg:left-[14.5rem]" aria-label="Close workspace" onclick={() => drawerOpen = false}></button>
            <aside class="absolute inset-y-0 right-0 z-30 flex w-full max-w-[24rem] flex-col border-l border-border bg-card shadow-2xl" aria-label="Context workspace">
              {@render workspaceHeader()}
              {@render workspaceBody()}
            </aside>
          {/if}
        {:else if variant === 'dock'}
          <aside class={`${drawerOpen ? 'absolute inset-y-0 right-0 z-30 flex w-full max-w-[22rem] shadow-2xl' : 'hidden'} min-h-0 flex-col border-l border-border bg-card lg:static lg:z-auto lg:flex lg:w-auto lg:max-w-none lg:bg-muted/10 lg:shadow-none`} aria-label="Context workspace">
            {#if drawerOpen}
              {@render workspaceHeader()}
              {@render workspaceBody()}
            {:else}
              <button class="flex h-full w-full flex-col items-center gap-3 pt-5 text-muted-foreground hover:bg-muted/30 hover:text-foreground" onclick={() => drawerOpen = true} aria-label="Open workspace">
                <PanelRight class="h-4 w-4" /><span class="[writing-mode:vertical-rl] text-xs font-medium tracking-wide">Open workspace</span>
              </button>
            {/if}
          </aside>
        {:else}
          <aside class={`${drawerOpen ? 'absolute inset-y-0 right-0 z-30 flex w-full max-w-[20rem] shadow-2xl' : 'hidden'} min-h-0 flex-col border-l border-border bg-card transition-all lg:static lg:z-auto lg:flex lg:w-auto lg:max-w-none lg:bg-muted/10 lg:shadow-none ${drawerOpen ? '' : 'items-stretch'}`} aria-label="Context edge">
            {#if drawerOpen}
              {@render workspaceHeader()}
              {@render workspaceBody()}
            {:else}
              <button class="flex items-center justify-between border-b border-border px-4 py-4 text-muted-foreground hover:text-foreground" onclick={() => drawerOpen = true} aria-label="Expand context edge"><PanelRight class="h-4 w-4" /><ChevronLeft class="h-4 w-4" /></button>
              <button class="flex-1 px-4 py-5 text-left hover:bg-muted/20" onclick={() => { drawerTab = 'review'; drawerOpen = true; }}>
                <span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Changes</span>
                <span class="mt-3 block text-2xl font-semibold">2</span>
                <span class="mt-1 block text-xs leading-5 text-muted-foreground">ready to review</span>
              </button>
              <button class="border-t border-border px-4 py-5 text-left hover:bg-muted/20" onclick={() => { drawerTab = 'discuss'; drawerOpen = true; }}>
                <MessageSquare class="h-4 w-4" /><span class="mt-2 block text-xs leading-5 text-muted-foreground">Discuss in context</span>
              </button>
            {/if}
          </aside>
        {/if}

      </div>
    {:else}
      <section class="min-h-0 flex-1 overflow-y-auto px-6 py-7 sm:px-10">
        <div class="mx-auto max-w-4xl">
          <div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div><p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Across every note</p><h2 class="mt-2 text-2xl font-semibold tracking-tight">All tasks</h2><p class="mt-1 text-sm text-muted-foreground">The complete ledger remains one step away from Focus.</p></div>
            <label class="flex h-9 items-center gap-2 border-b border-border text-muted-foreground focus-within:border-foreground sm:w-60"><Search class="h-4 w-4" /><input bind:value={query} aria-label="Find a task" placeholder="Find a task or note" class="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" /></label>
          </div>
          <div class="mt-7 border-y border-border">
            {#each filteredTasks as task (task.id)}
              <div class="grid items-center gap-3 border-b border-border/70 py-4 last:border-b-0 sm:grid-cols-[1.5rem_minmax(0,1fr)_7rem]">
                <button class="text-muted-foreground hover:text-foreground" onclick={() => toggleGlobalTask(task.id)} aria-label={task.completed ? `Reopen ${task.text}` : `Complete ${task.text}`}>{#if task.completed}<span class="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500 text-emerald-500"><Check class="h-3 w-3" /></span>{:else}<Circle class="h-5 w-5" />{/if}</button>
                <button class="min-w-0 text-left" onclick={() => notice = `Opening ${task.note}`}><span class={`block text-sm font-medium ${task.completed ? 'text-muted-foreground line-through' : ''}`}>{task.text}</span><span class="mt-1 block text-xs text-muted-foreground">{task.note} · {task.section}</span></button>
                <span class="hidden text-right text-xs text-muted-foreground sm:block">{task.timing}</span>
              </div>
            {/each}
          </div>
        </div>
      </section>
    {/if}
  </section>
</main>

{#snippet workspaceHeader()}
  <div class="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
    <div class="flex items-center gap-1 rounded-full bg-muted p-1">
      <button class={`rounded-full px-3 py-1.5 text-xs font-medium ${drawerTab === 'review' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onclick={() => drawerTab = 'review'}>Review</button>
      <button class={`rounded-full px-3 py-1.5 text-xs font-medium ${drawerTab === 'discuss' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onclick={() => drawerTab = 'discuss'}>Discuss</button>
    </div>
    <button class="text-muted-foreground hover:text-foreground" onclick={() => drawerOpen = false} aria-label="Close workspace">{#if variant === 'sidecar'}<ChevronRight class="h-4 w-4" />{:else}<X class="h-4 w-4" />{/if}</button>
  </div>
{/snippet}

{#snippet workspaceBody()}
  {#if drawerTab === 'review'}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="px-5 pb-4 pt-5">
        <p class="text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Proposed from this step</p>
        <h3 class="mt-2 text-lg font-semibold leading-6">Two changes, one duplicate</h3>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">Nothing is written until you keep it.</p>
      </div>
      <div class="border-y border-border">
        <div class="px-5 py-4">
          <div class="flex items-start justify-between gap-3"><p class="text-xs font-medium text-muted-foreground">Gneauxghts roadmap.md</p><button class={`text-xs font-semibold ${keptChanges.includes('device') ? 'text-emerald-500' : ''}`} onclick={() => keepChange('device')}>{keptChanges.includes('device') ? 'Kept' : 'Keep'}</button></div>
          <p class="mt-3 font-mono text-xs leading-5"><span class="mr-2 text-emerald-500">+</span>Document which settings follow the vault and which stay on the device</p>
        </div>
        <div class="border-t border-border px-5 py-4">
          <div class="flex items-start justify-between gap-3"><p class="text-xs font-medium text-muted-foreground">Mac sharing.md</p><button class={`text-xs font-semibold ${keptChanges.includes('recovery') ? 'text-emerald-500' : ''}`} onclick={() => keepChange('recovery')}>{keptChanges.includes('recovery') ? 'Kept' : 'Keep'}</button></div>
          <p class="mt-3 font-mono text-xs leading-5"><span class="mr-2 text-emerald-500">+</span>Define the recovery path for conflicting edits</p>
        </div>
        <div class="border-t border-border px-5 py-4 text-muted-foreground">
          <p class="text-xs font-medium">Meeting with Kylie.md</p>
          <p class="mt-3 font-mono text-xs leading-5"><span class="mr-2">≈</span>Skipped “send revised outline” — already exists</p>
        </div>
      </div>
      <div class="flex items-center justify-between gap-4 px-5 py-5">
        <span class="text-xs text-muted-foreground">{keptChanges.length} of 2 kept</span>
        <button class="inline-flex items-center gap-2 text-sm font-medium" onclick={() => notice = `${keptChanges.length || 2} changes applied in this mock`} >Apply selected <ArrowRight class="h-4 w-4" /></button>
      </div>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <p class="text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Discuss this step</p>
        <div class="mt-5 border-l border-border pl-4">
          <p class="text-sm leading-6">Why should device identity stay explicit?</p>
          <p class="mt-1 text-xs text-muted-foreground">You · 4 minutes ago</p>
        </div>
        <div class="mt-5 border-l-2 border-foreground pl-4">
          <p class="text-sm leading-6">Because the same vault can be open on both Macs. Explicit identity lets recovery name where each conflicting edit came from instead of presenting two anonymous versions.</p>
          <p class="mt-2 text-xs text-muted-foreground">Gneauxghts · using this note and the sharing brief</p>
        </div>
        <button class="mt-7 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground" onclick={() => notice = 'Source context opened'}><ArrowLeft class="h-3.5 w-3.5" /> See the source context</button>
      </div>
      <form class="shrink-0 border-t border-border p-4" onsubmit={(event) => { event.preventDefault(); sendMessage(); }}>
        <div class="flex items-end gap-3 rounded-2xl border border-border bg-background px-3 py-2 focus-within:border-foreground">
          <textarea bind:value={composer} rows="2" class="min-h-10 min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 outline-none" placeholder="Ask about this step" aria-label="Ask about this step"></textarea>
          <button type="submit" class="mb-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background" aria-label="Send"><Send class="h-3.5 w-3.5" /></button>
        </div>
      </form>
    </div>
  {/if}
{/snippet}

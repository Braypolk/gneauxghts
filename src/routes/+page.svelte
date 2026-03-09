<script lang="ts">
  import type { Crepe } from '@milkdown/crepe';
  import { Settings, Search, Maximize2, Minimize2, Frame } from 'lucide-svelte';
  import { onMount } from 'svelte';

  const initialMarkdown = `# A thought worth keeping

I think the feedback you're getting here is approval based on a rule of thumb, but typography is not about rules in isolation. It's the art of laying out meaningful thoughts in a way that respects the reader and the content.

It's about how someone reads something, not just about applying general rules.

## What to watch for

- Keep ideas intact across line breaks.
- Break lines where the sentence still feels natural.
- Let readability drive the composition.

There are at least a dozen of these issues where moving a single word would better respect the thought being expressed. Aesthetics matter, but only when they serve the reading experience.`;

  let crepe: Crepe | null = null;
  let editorRoot: HTMLDivElement | null = null;
  let isEditorReady = $state(false);
  let isRelatedOpen = $state(true);
  let markdown = $state(initialMarkdown);
  /** True after Forget is clicked; show Unforget until notepad has content again */
  let canUnforget = $state(false);
  /** Ignore the first stale non-empty markdown update after Forget. */
  let isWaitingForForgetSync = false;
  let ignoredForgetStaleUpdate = false;

  function toggleRelated() {
    isRelatedOpen = !isRelatedOpen;
  }

  async function initEditor(initialValue: string) {
    if (!editorRoot) return;

    const { Crepe } = await import('@milkdown/crepe');

    crepe = new Crepe({
      root: editorRoot,
      defaultValue: initialValue,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: 'Start writing',
          mode: 'doc'
        }
      }
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, nextMarkdown) => {
        if (isWaitingForForgetSync) {
          if (nextMarkdown.trim() === '') {
            markdown = nextMarkdown;
            isWaitingForForgetSync = false;
            ignoredForgetStaleUpdate = false;
            return;
          }

          if (!ignoredForgetStaleUpdate) {
            ignoredForgetStaleUpdate = true;
            return;
          }
        }

        markdown = nextMarkdown;
        if (nextMarkdown.trim() !== '') canUnforget = false;
      });
    });

    await crepe.create();
    isEditorReady = true;
  }

  /** Clear the notepad with a single transaction so Crepe's Undo restores it */
  async function clearNotepad() {
    if (!crepe) return;
    const { editorViewCtx } = await import('@milkdown/kit/core');
    const { Fragment, Slice } = await import('prosemirror-model');
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx) as unknown as {
        state: { doc: { content: { size: number } }; schema: { nodes: { paragraph: { create: () => unknown } } }; tr: { replace: (from: number, to: number, slice: InstanceType<typeof Slice>) => unknown } };
        dispatch: (tr: unknown) => void;
      };
      const { state } = view;
      const from = 1;
      const to = state.doc.content.size - 1;
      const emptyParagraph = state.schema.nodes.paragraph.create();
      const slice = new Slice(Fragment.from(emptyParagraph as import('prosemirror-model').Node), 0, 0);
      const tr = state.tr.replace(from, to, slice);
      view.dispatch(tr);
    });
    markdown = '';
    isWaitingForForgetSync = true;
    ignoredForgetStaleUpdate = false;
    canUnforget = true;
  }

  /** Restore notepad by triggering one Undo (same as Cmd+Z after Forget) */
  async function unforgetNotepad() {
    if (!crepe) return;
    const { editorViewCtx } = await import('@milkdown/kit/core');
    const { undo } = await import('prosemirror-history');
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx) as unknown as {
        state: Parameters<typeof undo>[0];
        dispatch: NonNullable<Parameters<typeof undo>[1]>;
      };
      undo(view.state, view.dispatch);
    });
    canUnforget = false;
  }

  onMount(() => {
    let mounted = true;
    void initEditor(markdown).then(() => {
      if (!mounted) return;
    });

    return () => {
      mounted = false;
      isEditorReady = false;

      if (crepe) {
        void crepe.destroy();
        crepe = null;
      }
    };
  });
</script>

<div class="h-full w-full bg-[#f8f9fa] flex flex-col font-sans overflow-hidden">
  <!-- Top Navigation -->
  <header class="flex items-center justify-between px-6 shrink-0 relative z-10">
    <!-- Three layout columns to keep center strictly centered -->
    <div class="flex-1 flex justify-start">
      <!-- Empty space on left -->
    </div>
    
    <div class="flex justify-center">
      <nav class="flex items-center gap-6 bg-white/50 backdrop-blur-md px-2 py-2 rounded-full shadow-sm border border-gray-100/50">
        <a href="/" class="text-sm font-medium text-gray-900 bg-white px-4 py-1.5 rounded-full shadow-sm">Gneauxght</a>
        <a href="/inbox" class="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-2">Inbox</a>
        <a href="/map" class="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-2">Map</a>
        <a href="/list" class="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-2 mr-2">List</a>
      </nav>
    </div>

    <div class="flex-1 flex justify-end">
      <button class="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200 bg-white rounded-full transition-colors shadow-sm">
        <Settings class="w-5 h-5" />
      </button>
    </div>
  </header>

  <!-- Main Content Area -->
  <main class="flex-1 relative flex overflow-hidden p-6 transition-all duration-300 ease-in-out justify-center max-w-[1600px] mx-auto w-full">
    
    <!-- Notepad Container -->
    <div 
      class="flex-1 flex justify-center h-full transition-all duration-500 max-w-5xl w-full"
      class:mr-6={isRelatedOpen}
    >
      <!-- The Notepad -->
      <div class="w-full bg-white rounded-[2rem] shadow-sm border border-gray-200 flex flex-col min-h-0 overflow-hidden transition-all duration-300">
        <div class="flex-1 min-h-0">
          <div class="notepad-editor-shell relative h-full">
            {#if !isEditorReady}
              <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <span class="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 shadow-sm">
                  Loading editor
                </span>
              </div>
            {/if}

            <div bind:this={editorRoot} class="h-full min-h-0"></div>
          </div>
          <!-- Bottom Bar -->
        <div class="p-2 shrink-0 flex items-center justify-between gap-4 sticky bottom-0 border-t border-transparent px-10">
          {#if canUnforget}
            <button
              type="button"
              class="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-gray-200 min-w-[100px]"
              onclick={() => void unforgetNotepad()}
            >
              Unforget
            </button>
          {:else}
            <button
              type="button"
              class="px-6 py-2.5 bg-[#f8f9fa] hover:bg-gray-100 text-gray-700 font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-gray-100 min-w-[100px]"
              onclick={() => void clearNotepad()}
            >
              Forget
            </button>
          {/if}
          
          <div class="search-bar max-w-md w-full flex items-center gap-2 rounded-full pl-5 pr-2 py-2 border border-gray-200/60 overflow-visible">
            <Search class="w-4 h-4 shrink-0 text-gray-400" />
            <div class="search-bar-input-wrap flex-1 min-w-0">
              <input
                type="text"
                autocomplete="off"
                class="search-bar-input w-full py-1.5 outline-none text-gray-700 placeholder:text-gray-400 text-sm"
              />
            </div>
            <div class="flex items-center gap-1 border-l border-gray-200 pl-2 shrink-0">
              <button type="button" class="flex items-center justify-center hover:text-gray-700 hover:bg-gray-200 p-1.5 rounded-md transition-colors" aria-label="Frame"><Frame class="w-4 h-4" /></button>
              <button type="button" class="flex items-center justify-center hover:text-gray-700 hover:bg-gray-200 p-1.5 rounded-md transition-colors" aria-label="Minimize"><Minimize2 class="w-4 h-4" /></button>
              <button type="button" class="flex items-center justify-center hover:text-gray-700 hover:bg-gray-200 p-1.5 rounded-md transition-colors" aria-label="Expand"><Maximize2 class="w-4 h-4" /></button>
            </div>
          </div>

          <button class="px-6 py-2.5 bg-[#f8f9fa] hover:bg-gray-100 text-gray-700 font-medium rounded-full transition-colors shadow-sm cursor-pointer border border-gray-100 min-w-[100px]">
            Remember
          </button>
        </div>
        </div>
      </div>
    </div>

    <!-- Related Sidebar Container -->
    <div class="relative flex-none transition-all duration-500 ease-in-out h-full flex items-start {isRelatedOpen ? 'w-[340px] opacity-100' : 'w-0 opacity-0'}">
      <!-- The full sidebar when open -->
      <div class="absolute right-0 top-0 bottom-0 w-[340px] bg-white rounded-[2rem] shadow-sm border border-gray-200 flex flex-col overflow-hidden transition-transform duration-500 ease-in-out {isRelatedOpen ? 'translate-x-0' : 'translate-x-full'}">
        <div class="p-8 pb-4 shrink-0 flex items-center justify-center relative">
          <h3 class="font-medium text-gray-900 text-lg">Related</h3>
          <button class="absolute right-6 top-8 text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-full p-1.5 transition-colors cursor-pointer" onclick={toggleRelated} aria-label="Close Related">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
          <!-- Note Card 1 -->
          <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
            <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
            <p class="text-sm text-gray-600 leading-relaxed">
              most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
            </p>
          </div>
          
          <!-- Note Card 2 -->
          <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
            <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
            <p class="text-sm text-gray-600 leading-relaxed">
              most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
            </p>
          </div>

          <!-- Note Card 3 -->
          <div class="bg-[#f8f9fa] p-5 rounded-3xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
            <h4 class="font-semibold text-gray-900 mb-2">Note 1</h4>
            <p class="text-sm text-gray-600 leading-relaxed">
              most relevant piece of info shown or if not confident just show the note up until a certain point and then it eventually just gets cut off...
            </p>
          </div>
        </div>
      </div>
    </div>
    
    <!-- The visible edge when closed -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#if !isRelatedOpen}
      <div 
        class="fixed right-0 top-1/2 -translate-y-1/2 w-4 h-32 bg-white border border-gray-200 border-r-0 rounded-l-xl shadow-md cursor-pointer hover:w-6 transition-all hover:bg-gray-50 flex items-center justify-center group z-20"
        onclick={toggleRelated}
        title="Open Related"
      >
        <div class="w-1 h-10 rounded-full bg-gray-300 group-hover:bg-gray-400 transition-colors"></div>
      </div>
    {/if}
  </main>
</div>

<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Crepe } from '@milkdown/crepe';
  import { editorViewCtx } from '@milkdown/kit/core';
  import { TextSelection } from '@milkdown/kit/prose/state';
  import { onMount, tick } from 'svelte';
  import { consumePendingTaskTarget, type PendingTaskTarget } from '$lib/taskNavigation';
  import type { SearchItem } from '$lib/types/semantic';
  import { notepadWikilinks } from './notepadWikilinks';
  import { setupNotepadSlashMenuPortal } from './notepadSlashMenuPortal';
  import BottomBar from './BottomBar.svelte';

  interface NoteSession {
    markdown: string;
    path: string | null;
  }

  interface RecentTaskItem {
    taskKey: string;
    notePath: string;
    noteTitle: string;
    text: string;
    lineNumber: number;
    updatedAtMillis: number;
  }

  interface ForgottenNote {
    title: string;
    bodyMarkdown: string;
    currentNotePath: string | null;
  }

  interface ResolvedNoteLink {
    notePath: string;
    sectionLabel: string;
    matchText: string;
  }

  let crepe: Crepe | null = null;
  let notepadShell: HTMLDivElement | null = null;
  let editorRoot: HTMLDivElement | null = null;
  let slashMenuPortal: HTMLDivElement | null = null;
  let titleInput: HTMLInputElement | null = null;
  let titleShell: HTMLDivElement | null = null;
  let isEditorReady = $state(false);
  let title = $state('');
  let bodyMarkdown = $state('');
  let currentNotePath = $state<string | null>(null);
  let lastSavedMarkdown = '';
  let lastSavedPath: string | null = null;
  let canUnforget = $state(false);
  let forgottenNote: ForgottenNote | null = null;
  let saveTimer: ReturnType<typeof window.setTimeout> | null = null;
  let saveQueue: Promise<void> = Promise.resolve();
  let searchMode = $state<'current' | 'all'>('all');
  let searchQuery = $state('');
  let searchResults = $state<SearchItem[]>([]);
  let recentNotes = $state<SearchItem[]>([]);
  let recentTasks = $state<RecentTaskItem[]>([]);
  let isSearching = $state(false);
  let searchTimer: ReturnType<typeof window.setTimeout> | null = null;
  let activeSearchRequest = 0;
  let activeRecentNotesRequest = 0;
  let activeRecentTasksRequest = 0;
  let searchFocusRequest = $state(0);
  let slashMenuPortalCleanup: (() => void) | null = null;

  const wikilinkSlashIcon = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M10 9H6.75A3.75 3.75 0 1 0 6.75 16.5H10" />
      <path d="M14 15H17.25A3.75 3.75 0 1 0 17.25 7.5H14" />
      <path d="M8.5 12h7" />
    </svg>
  `;

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
        },
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) => {
            builder.getGroup('text').addItem('wikilink', {
              label: 'Wikilink',
              icon: wikilinkSlashIcon,
              onRun: (ctx) => {
                const view = ctx.get(editorViewCtx);
                const selectionFrom = view.state.selection.$from;
                const from = selectionFrom.start();
                const to = selectionFrom.end();
                const transaction = view.state.tr.insertText('[[]]', from, to);
                transaction.setSelection(TextSelection.create(transaction.doc, from + 2));
                view.dispatch(transaction);
                view.focus();
              }
            });
          }
        }
      }
    });

    crepe.addFeature(notepadWikilinks, {
      onOpenLink: (rawTarget) => {
        void openWikilink(rawTarget);
      }
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, nextMarkdown) => {
        bodyMarkdown = nextMarkdown;
        if (nextMarkdown.trim() !== '') canUnforget = false;
        scheduleAutosave();
        scheduleSearch();
      });
    });

    await crepe.create();
    setupSlashMenuPortal();
  }

  function parseStoredMarkdown(markdown: string) {
    const normalized = markdown.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const firstContentLineIndex = lines.findIndex((line) => line.trim() !== '');

    if (firstContentLineIndex === -1) {
      return { title: '', bodyMarkdown: '' };
    }

    const firstContentLine = lines[firstContentLineIndex];
    const headingMatch = firstContentLine.match(/^#\s+(.*)$/);

    if (!headingMatch) {
      return { title: '', bodyMarkdown: normalized };
    }

    const remainingLines = lines.slice(firstContentLineIndex + 1);
    if (remainingLines[0]?.trim() === '') remainingLines.shift();

    return {
      title: headingMatch[1].trim(),
      bodyMarkdown: remainingLines.join('\n')
    };
  }

  function composeMarkdown(noteTitle: string, noteBody: string) {
    const normalizedBody = noteBody.replace(/\r\n/g, '\n');
    const trimmedTitle = noteTitle.trim();

    if (!trimmedTitle) return normalizedBody;

    const bodyWithoutLeadingSpace = normalizedBody.replace(/^\n+/, '');
    return bodyWithoutLeadingSpace ? `# ${trimmedTitle}\n\n${bodyWithoutLeadingSpace}` : `# ${trimmedTitle}`;
  }

  function getCurrentMarkdown() {
    return composeMarkdown(title, bodyMarkdown);
  }

  async function destroyEditor() {
    if (slashMenuPortalCleanup) {
      slashMenuPortalCleanup();
      slashMenuPortalCleanup = null;
    }

    if (!crepe) return;
    await crepe.destroy();
    crepe = null;
  }

  function setupSlashMenuPortal() {
    if (!notepadShell || !editorRoot || !slashMenuPortal) return;

    if (slashMenuPortalCleanup) {
      slashMenuPortalCleanup();
      slashMenuPortalCleanup = null;
    }

    // Crepe mounts the slash menu inside the clipped editor tree, so we reparent and clamp it here.
    slashMenuPortalCleanup = setupNotepadSlashMenuPortal({
      boundsElement: notepadShell,
      editorRoot,
      portalRoot: slashMenuPortal
    });
  }

  async function createEditor(initialValue: string) {
    if (!editorRoot) return;
    await tick();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!editorRoot) return;
    await initEditor(initialValue);
    isEditorReady = true;
  }

  async function replaceEditorContent(nextMarkdown: string) {
    isEditorReady = false;
    await destroyEditor();
    bodyMarkdown = nextMarkdown;
    await createEditor(nextMarkdown);
  }

  async function clearNotepad({ canRestore = true }: { canRestore?: boolean } = {}) {
    const hasContent = title.trim() !== '' || bodyMarkdown.trim() !== '' || currentNotePath !== null;
    const noteToForget =
      canRestore && hasContent
        ? {
            title,
            bodyMarkdown,
            currentNotePath
          }
        : null;

    if (currentNotePath) {
      try {
        await invoke('forget_note', { currentPath: currentNotePath });
      } catch (error) {
        console.error('Failed to forget note:', error);
        return;
      }
    }

    forgottenNote = noteToForget;
    title = '';
    currentNotePath = null;
    lastSavedMarkdown = '';
    lastSavedPath = null;
    canUnforget = canRestore && hasContent;
    await replaceEditorContent('');
    scheduleSearch();
    void loadRecentNotes();
  }

  async function unforgetNotepad() {
    if (!forgottenNote) return;
    title = forgottenNote.title;
    currentNotePath = forgottenNote.currentNotePath;
    lastSavedMarkdown = '';
    lastSavedPath = null;
    canUnforget = false;
    await replaceEditorContent(forgottenNote.bodyMarkdown);
    forgottenNote = null;
    scheduleAutosave();
    scheduleSearch();
    void loadRecentNotes();
  }

  async function loadSavedNote() {
    try {
      const saved = await invoke<NoteSession>('load_note_session');
      const parsed = parseStoredMarkdown(saved.markdown);
      title = parsed.title;
      bodyMarkdown = parsed.bodyMarkdown;
      currentNotePath = saved.path;
      lastSavedMarkdown = saved.markdown;
      lastSavedPath = saved.path;
    } catch (error) {
      console.error('Failed to load saved note:', error);
      title = '';
      bodyMarkdown = '';
      currentNotePath = null;
      lastSavedMarkdown = '';
      lastSavedPath = null;
    }
  }

  function scheduleAutosave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void enqueueSave('autosave');
    }, 500);
  }

  function scheduleSearch() {
    if (searchTimer) window.clearTimeout(searchTimer);

    if (searchQuery.trim() === '') {
      searchResults = [];
      isSearching = false;
      return;
    }

    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      void runSearch(searchQuery);
    }, 120);
  }

  async function enqueueSave(mode: 'autosave' | 'remember') {
    saveQueue = saveQueue
      .then(() => persistNote(mode))
      .catch((error) => {
        console.error(`Failed to ${mode} note:`, error);
      });

    return saveQueue;
  }

  function flushPendingAutosave() {
    if (!saveTimer) return;

    window.clearTimeout(saveTimer);
    saveTimer = null;
    void enqueueSave('autosave');
  }

  async function persistNote(mode: 'autosave' | 'remember') {
    const markdown = getCurrentMarkdown();

    if (mode === 'autosave' && markdown === lastSavedMarkdown && currentNotePath === lastSavedPath) {
      return;
    }

    if (mode === 'remember') {
      await invoke('remember_note', { markdown, currentPath: currentNotePath });
      return;
    }

    const saved = await invoke<NoteSession>('save_note', { markdown, currentPath: currentNotePath });
    currentNotePath = saved.path;
    lastSavedMarkdown = saved.markdown;
    lastSavedPath = saved.path;
  }

  async function rememberCurrentNote() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    await enqueueSave('remember');
    currentNotePath = null;
    lastSavedMarkdown = '';
    lastSavedPath = null;
    forgottenNote = null;
    clearSearch();
    await clearNotepad({ canRestore: false });
  }

  function handleTitleInput(event: Event) {
    title = (event.currentTarget as HTMLInputElement).value;
    if (title.trim() !== '' || bodyMarkdown.trim() !== '') canUnforget = false;
    scheduleAutosave();
    scheduleSearch();
  }

  function findLastSelectionPoint(node: Node): { node: Node; offset: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset: node.textContent?.length ?? 0 };
    }

    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      const child = node.childNodes[index];
      const point = findLastSelectionPoint(child);
      if (point) return point;
    }

    if (node instanceof HTMLElement) {
      return { node, offset: node.childNodes.length };
    }

    return null;
  }

  function isKeywordResult(result: SearchItem) {
    return result.reasonLabels.includes('keyword');
  }

  function isSemanticOnlyResult(result: SearchItem) {
    return result.reasonLabels.includes('semantic') && !isKeywordResult(result);
  }

  function focusTitleAtEnd() {
    if (!titleInput) return;
    titleInput.focus();
    const end = titleInput.value.length;
    titleInput.setSelectionRange(end, end);
  }

  function focusEditorTarget(target: HTMLElement) {
    const proseMirror = editorRoot?.querySelector('.ProseMirror');
    if (!(proseMirror instanceof HTMLElement)) return;

    const point = findLastSelectionPoint(target);
    proseMirror.focus({ preventScroll: true });

    if (!point) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function focusEditorAtEnd() {
    await tick();

    const proseMirror = editorRoot?.querySelector('.ProseMirror');
    if (!(proseMirror instanceof HTMLElement)) return;

    proseMirror.focus();

    const point = findLastSelectionPoint(proseMirror);
    const selection = window.getSelection();
    if (!point || !selection) return;

    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const selectionTarget =
      point.node instanceof HTMLElement ? point.node : point.node.parentElement ?? proseMirror;
    selectionTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void focusEditorAtEnd();
  }

  function clearSearch() {
    searchQuery = '';
    searchResults = [];
    isSearching = false;
    activeSearchRequest += 1;
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  async function runSearch(query: string) {
    const trimmedQuery = query.trim();
    if (trimmedQuery === '') {
      searchResults = [];
      isSearching = false;
      return;
    }

    const requestId = ++activeSearchRequest;
    isSearching = true;

    try {
      const results = await invoke<SearchItem[]>('search_notes_hybrid', {
        query: trimmedQuery,
        mode: searchMode,
        currentPath: currentNotePath,
        currentMarkdown: getCurrentMarkdown(),
        limit: 12
      });

      if (requestId !== activeSearchRequest) return;
      searchResults = results;
    } catch (error) {
      if (requestId !== activeSearchRequest) return;
      console.error('Failed to search notes:', error);
      searchResults = [];
    } finally {
      if (requestId === activeSearchRequest) {
        isSearching = false;
      }
    }
  }

  async function loadRecentNotes() {
    const requestId = ++activeRecentNotesRequest;

    try {
      const notes = await invoke<SearchItem[]>('list_recent_notes', {
        limit: 12,
        currentPath: currentNotePath,
        currentMarkdown: getCurrentMarkdown()
      });

      if (requestId !== activeRecentNotesRequest) return;
      recentNotes = notes;
    } catch (error) {
      if (requestId !== activeRecentNotesRequest) return;
      console.error('Failed to load recent notes:', error);
      recentNotes = [];
    }
  }

  async function loadRecentTasks() {
    const requestId = ++activeRecentTasksRequest;

    try {
      const tasks = await invoke<RecentTaskItem[]>('list_recent_tasks', {
        limit: 12
      });

      if (requestId !== activeRecentTasksRequest) return;
      recentTasks = tasks;
    } catch (error) {
      if (requestId !== activeRecentTasksRequest) return;
      console.error('Failed to load recent tasks:', error);
      recentTasks = [];
    }
  }

  function handleSearchInput(value: string) {
    searchQuery = value;
    if (value.trim() === '') {
      searchResults = [];
      isSearching = false;
      return;
    }
    scheduleSearch();
  }

  async function handleSearchModeChange(mode: 'current' | 'all') {
    searchMode = mode;
    if (searchQuery.trim() !== '') {
      await runSearch(searchQuery);
    }
  }

  function handleSearchFocus() {
    void loadRecentNotes();
    void loadRecentTasks();
  }

  function requestSearchFocus(mode: 'current' | 'all') {
    searchMode = mode;
    if (searchQuery.trim() !== '') {
      void runSearch(searchQuery);
    }
    searchFocusRequest += 1;
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (!event.metaKey || event.key.toLowerCase() !== 'f') return;

    event.preventDefault();
    requestSearchFocus(event.shiftKey ? 'all' : 'current');
  }

  function normalizePlainText(value: string) {
    return value
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/^\s*[-*+]\s+\[(?: |x|X)\]\s+/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*>\s+/gm, '')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function getEditorBlocks() {
    const proseMirror = editorRoot?.querySelector('.ProseMirror');
    if (!proseMirror) return [];

    return Array.from(proseMirror.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  }

  function getEditorTargets() {
    const proseMirror = editorRoot?.querySelector('.ProseMirror');
    if (!proseMirror) return [];

    const matches = Array.from(
      proseMirror.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6, blockquote, pre')
    ).filter((node): node is HTMLElement => node instanceof HTMLElement);

    const nonEmptyMatches = matches.filter((node) => normalizePlainText(node.textContent ?? '') !== '');
    if (nonEmptyMatches.length > 0) {
      return nonEmptyMatches;
    }

    return getEditorBlocks();
  }

  function findBestEditorTarget(matchText: string, preferredBlockIndex?: number) {
    const normalizedNeedle = normalizePlainText(matchText);
    if (!normalizedNeedle) return null;

    if (preferredBlockIndex !== undefined) {
      const blocks = getEditorBlocks();
      const directMatch = blocks[preferredBlockIndex];
      if (directMatch && normalizePlainText(directMatch.textContent ?? '').includes(normalizedNeedle)) {
        return directMatch;
      }
    }

    const targets = getEditorTargets();
    const exactMatch =
      targets.find((target) => normalizePlainText(target.textContent ?? '') === normalizedNeedle) ?? null;

    if (exactMatch) {
      return exactMatch;
    }

    const partialMatches = targets.filter((target) =>
      normalizePlainText(target.textContent ?? '').includes(normalizedNeedle)
    );

    if (partialMatches.length === 0) {
      return null;
    }

    partialMatches.sort((left, right) => {
      const leftLength = normalizePlainText(left.textContent ?? '').length;
      const rightLength = normalizePlainText(right.textContent ?? '').length;
      return leftLength - rightLength;
    });

    return partialMatches[0] ?? null;
  }

  async function waitForEditorPaint() {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function openNotePath(notePath: string) {
    const session = await invoke<NoteSession>('open_note', { path: notePath });
    const parsed = parseStoredMarkdown(session.markdown);

    title = parsed.title;
    currentNotePath = session.path;
    lastSavedMarkdown = session.markdown;
    lastSavedPath = session.path;
    canUnforget = false;
    forgottenNote = null;
    await replaceEditorContent(parsed.bodyMarkdown);
  }

  async function navigateToSectionTarget(sectionLabel: string, matchText: string, shouldFocus = true) {
    await waitForEditorPaint();

    if (sectionLabel === 'Title') {
      titleShell?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (shouldFocus) {
        focusTitleAtEnd();
      }
      return;
    }

    const paragraphMatch = sectionLabel.match(/^Paragraph (\d+)$/);
    const paragraphIndex = paragraphMatch ? Number(paragraphMatch[1]) - 1 : undefined;
    const targetBlock = findBestEditorTarget(matchText || sectionLabel, paragraphIndex);

    if (!targetBlock) {
      return;
    }

    if (!shouldFocus) {
      targetBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    focusEditorTarget(targetBlock);
  }

  async function navigateToSearchResult(result: SearchItem) {
    await navigateToSectionTarget(result.sectionLabel, result.matchText, !isSemanticOnlyResult(result));
  }

  async function navigateToPendingTaskTarget(target: PendingTaskTarget) {
    if (!currentNotePath || currentNotePath !== target.notePath) {
      return;
    }

    await waitForEditorPaint();

    const targetBlock = findBestEditorTarget(target.text);
    if (targetBlock) {
      targetBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function openSearchResult(result: SearchItem) {
    const shouldOpenDifferentNote = !!result.notePath && result.notePath !== currentNotePath;

    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (shouldOpenDifferentNote) {
      await enqueueSave('autosave');
    }

    try {
      if (shouldOpenDifferentNote && result.notePath) {
        await openNotePath(result.notePath);
        clearSearch();
        await navigateToSearchResult(result);
        return;
      }

      clearSearch();
      await navigateToSearchResult(result);
    } catch (error) {
      console.error('Failed to open searched note:', error);
    }
  }

  async function openRecentTask(task: RecentTaskItem) {
    const shouldOpenDifferentNote = task.notePath !== currentNotePath;

    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (shouldOpenDifferentNote) {
      await enqueueSave('autosave');
    }

    try {
      if (shouldOpenDifferentNote) {
        await openNotePath(task.notePath);
        clearSearch();
      } else {
        clearSearch();
      }

      await navigateToPendingTaskTarget({
        notePath: task.notePath,
        text: task.text,
        lineNumber: task.lineNumber,
        sectionLabel: null
      });
    } catch (error) {
      console.error('Failed to open recent task:', error);
    }
  }

  async function openResolvedNoteLink(target: ResolvedNoteLink) {
    const shouldOpenDifferentNote = target.notePath !== currentNotePath;

    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (shouldOpenDifferentNote) {
      await enqueueSave('autosave');
    }

    try {
      if (shouldOpenDifferentNote) {
        await openNotePath(target.notePath);
      }

      await navigateToSectionTarget(target.sectionLabel, target.matchText);
    } catch (error) {
      console.error('Failed to open wikilink target:', error);
    }
  }

  async function openWikilink(rawTarget: string) {
    try {
      const resolved = await invoke<ResolvedNoteLink | null>('resolve_note_link', {
        rawTarget,
        currentPath: currentNotePath,
        currentMarkdown: getCurrentMarkdown()
      });

      if (!resolved) {
        return;
      }

      await openResolvedNoteLink(resolved);
    } catch (error) {
      console.error('Failed to resolve wikilink:', error);
    }
  }

  onMount(() => {
    let mounted = true;

    (async () => {
      await tick();
      if (!mounted || !editorRoot) return;
      await loadSavedNote();
      if (!mounted || !editorRoot) return;
      try {
        await createEditor(bodyMarkdown);
        const pendingTaskTarget = consumePendingTaskTarget();
        if (pendingTaskTarget) {
          await navigateToPendingTaskTarget(pendingTaskTarget);
        }
      } catch (err) {
        console.error('Notepad init failed:', err);
      }
    })();

    return () => {
      mounted = false;
      isEditorReady = false;
      flushPendingAutosave();
      if (searchTimer) window.clearTimeout(searchTimer);
      void destroyEditor();
    };
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div bind:this={notepadShell} class="notepad-shell relative w-full h-full min-h-0 overflow-visible">
  <div class="w-full h-full min-h-0 text-card-foreground rounded-[2rem] shadow-sm border border-border flex flex-col overflow-hidden transition-all duration-300 relative">
    <!-- Title bar -->
    <div class="absolute top-0 left-0 right-0 z-20">
      <div class="relative">
        <div
          class="pointer-events-none absolute inset-0 bg-card/70 backdrop-blur-md"
          style="mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); -webkit-mask-image: linear-gradient(to top, transparent 0%, black 40%, black 100%); mask-size: 100% 100%; -webkit-mask-size: 100% 100%;"
        ></div>
        <div class="relative z-10 px-8 pt-3 pb-4">
          <div bind:this={titleShell} class="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 rounded-[1.4rem] px-4 py-2 transition-all duration-300">
            <div class="flex w-full items-center justify-center gap-3 text-3xl font-semibold tracking-tight text-foreground">
              <input
                bind:this={titleInput}
                type="text"
                class="w-full max-w-2xl bg-transparent text-center outline-none placeholder:text-muted-foreground/55"
                placeholder="Title"
                value={title}
                oninput={handleTitleInput}
                onkeydown={handleTitleKeydown}
              />
            </div>
            <div class="h-px w-40 rounded-full bg-border"></div>
          </div>
        </div>
      </div>
    </div>
    <!-- Editor Area -->
    <div class="flex-1 min-h-0">
      <div class="notepad-editor-shell relative h-full">
        {#if !isEditorReady}
          <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span class="rounded-full bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
              Loading editor
            </span>
          </div>
        {/if}

        <div bind:this={editorRoot} class="min-h-full"></div>
      </div>
    </div>
    <!-- Bottom Bar -->
    <div class="absolute bottom-0 left-0 right-0 z-10">
      <BottomBar
        {canUnforget}
        {searchMode}
        {searchQuery}
        {searchResults}
        {recentNotes}
        {recentTasks}
        {isSearching}
        focusRequest={searchFocusRequest}
        onForget={() => void clearNotepad()}
        onUnforget={() => void unforgetNotepad()}
        onRemember={() => void rememberCurrentNote()}
        onSearchInput={handleSearchInput}
        onSearchModeChange={handleSearchModeChange}
        onSearchSelect={(result) => void openSearchResult(result)}
        onRecentTaskSelect={(task) => void openRecentTask(task)}
        onSearchFocus={handleSearchFocus}
      />
    </div>
  </div>
  <div bind:this={slashMenuPortal} class="notepad-slash-portal milkdown fixed inset-0 z-40 pointer-events-none"></div>
</div>

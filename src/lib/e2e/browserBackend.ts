type NoteFixture = {
  noteId: string;
  title: string;
  markdown: string;
  path: string;
};

type InvokeRecord = { command: string; args: Record<string, unknown> };
type TauriCallback = (payload: unknown) => void;

const alphaMarkdown = Array.from(
  { length: 80 },
  (_, index) => `Alpha line ${index + 1}: browser regression fixture`
).join('\n\n');

const notes = new Map<string, NoteFixture>([
  [
    'note-alpha',
    {
      noteId: 'note-alpha',
      title: 'Alpha note',
      markdown: alphaMarkdown,
      path: '/e2e/alpha.md'
    }
  ],
  [
    'note-beta',
    {
      noteId: 'note-beta',
      title: 'Beta note',
      markdown: [
        'Beta body is independent from Alpha.',
        '',
        '- [ ] Beta task',
        '  - [x] Nested completed task',
        '',
        '==Highlighted words remain selectable==',
        '',
        '| Column A | Column B |',
        '| --- | --- |',
        `| ${'wide '.repeat(36)}| synchronized row |`,
        '',
        '```text',
        'first line in one multiline block',
        'second line in one multiline block',
        '```',
        '',
        `Wrapped block extent ${'continues across the narrow pane '.repeat(18)}`
      ].join('\n'),
      path: '/e2e/beta.md'
    }
  ]
]);

const semanticStatus = {
  settings: {
    semanticSearchEnabled: false,
    localOnlyMode: true,
    lexicalWeight: 1,
    semanticWeight: 0
  },
  model: {
    id: 'e2e-disabled',
    label: 'Disabled in E2E',
    dimensions: 0,
    localOnly: true,
    runtimeBinaryPath: null,
    modelPath: null,
    modelRepoId: '',
    available: false,
    loading: false,
    ready: false,
    status: 'disabled',
    error: null
  },
  platformSupported: true,
  disabledReason: 'Disabled in browser E2E',
  modelAvailable: false,
  indexingPaused: true,
  indexingInProgress: false,
  indexedNotes: 0,
  indexedChunks: 0,
  annIndexLoaded: false,
  annIndexDirty: false,
  annRebuildPending: false,
  annLastDumpedAtMillis: null,
  annIndexedChunks: 0,
  noteAnnIndexLoaded: false,
  noteAnnIndexDirty: false,
  noteAnnRebuildPending: false,
  noteAnnIndexedNotes: 0,
  noteAnnGenerationId: null,
  lastIndexedAtMillis: null,
  lastError: null,
  currentJobLabel: null,
  latestJob: null,
  health: 'paused',
  recoveryState: 'paused',
  indexUsable: false,
  retryAttempt: 0,
  retryMaxAttempts: 0,
  retryExhausted: false,
  progressCurrent: 0,
  progressTotal: 0,
  rebuildReason: null
};

function session(note: NoteFixture) {
  return {
    noteId: note.noteId,
    title: note.title,
    markdown: note.markdown,
    path: note.path
  };
}

function searchItem(note: NoteFixture) {
  return {
    documentKind: 'note',
    noteId: note.noteId,
    notePath: note.path,
    fileName: `${note.title}.md`,
    sectionLabel: note.title,
    excerpt: note.markdown.slice(0, 120),
    highlightRanges: [],
    matchText: note.title,
    reasonLabels: ['keyword'],
    lexicalScore: 1,
    semanticScore: null,
    startLine: 1,
    endLine: 1,
    blockAnchor: null
  };
}

function findNote(args: Record<string, unknown>) {
  const noteId = typeof args.noteId === 'string' ? args.noteId : null;
  const path = typeof args.path === 'string' ? args.path : null;
  return (
    (noteId ? notes.get(noteId) : undefined) ??
    [...notes.values()].find((note) => note.path === path) ??
    notes.get('note-alpha')!
  );
}

export function installBrowserE2eBackend() {
  if (!import.meta.env.DEV || import.meta.env.VITE_E2E_BROWSER !== 'true') return;
  if (window.__GNEAUXGHTS_E2E__) return;

  const callbacks = new Map<number, TauriCallback>();
  const invocations: InvokeRecord[] = [];
  let callbackId = 0;
  let activeNote = notes.get('note-alpha')!;
  const pinnedNoteIds = new Set<string>();

  const invoke = async (command: string, rawArgs: unknown = {}) => {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    invocations.push({ command, args });

    if (command === 'bootstrap_app') {
      return {
        vault: {
          currentPath: '/e2e',
          defaultPath: '/e2e',
          forgottenPath: '/e2e/.forgotten',
          isDefault: true,
          noteCount: notes.size,
          requiresRestart: false,
          canConfigurePath: false,
          canPickArbitraryPath: false,
          vaultContainerPath: '/e2e',
          pathConfigurationNote: null
        },
        noteSession: session(activeNote),
        semanticStatus,
        indexRevision: 1
      };
    }
    if (command === 'load_note_session') return session(activeNote);
    if (command === 'open_note' || command === 'read_note') {
      activeNote = findNote(args);
      return session(activeNote);
    }
    if (command === 'save_note') {
      const saved: NoteFixture = {
        ...activeNote,
        title: String(args.title ?? activeNote.title),
        markdown: String(args.markdown ?? activeNote.markdown)
      };
      notes.set(saved.noteId, saved);
      activeNote = saved;
      return session(saved);
    }
    if (command === 'search_notes_hybrid') {
      const query = String(args.query ?? '').toLowerCase();
      return [...notes.values()]
        .filter((note) => `${note.title}\n${note.markdown}`.toLowerCase().includes(query))
        .map(searchItem);
    }
    if (command === 'list_recent_notes') return [...notes.values()].map(searchItem);
    if (command === 'list_recent_focus') {
      return {
        pinnedNotes: [...pinnedNoteIds]
          .map((noteId) => notes.get(noteId))
          .filter((note): note is NoteFixture => Boolean(note))
          .map(searchItem),
        recentNotes: [...notes.values()].map(searchItem),
        lastChat: null
      };
    }
    if (command === 'set_note_pinned') {
      const noteId = String(args.noteId ?? '');
      if (args.pinned) pinnedNoteIds.add(noteId);
      else pinnedNoteIds.delete(noteId);
      return null;
    }
    if (command === 'get_related_notes') {
      return { status: 'ready', scope: 'note', reason: null, items: [] };
    }
    if (command === 'retrieve_note_context') {
      return { status: 'ready', scope: args.scope ?? 'note', reason: null, items: [] };
    }
    if (command === 'plugin:event|listen') return callbackId++;
    if (command === 'plugin:event|unlisten') return null;
    if (command.includes('list_') || command.includes('_list_')) return [];
    if (command.includes('get_settings')) return null;
    return null;
  };

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback: TauriCallback, once = false) {
      const id = callbackId++;
      callbacks.set(id, (payload) => {
        callback?.(payload);
        if (once) callbacks.delete(id);
      });
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    convertFileSrc(path: string) {
      return path;
    },
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' }
    }
  };

  window.__GNEAUXGHTS_E2E__ = {
    invocations,
    snapshot() {
      return {
        activeNoteId: activeNote.noteId,
        notes: [...notes.values()].map((note) => ({ ...note })),
        invocations: invocations.map((entry) => ({ ...entry }))
      };
    }
  };
}

declare global {
  interface Window {
    __TAURI_INTERNALS__: Record<string, unknown>;
    __GNEAUXGHTS_E2E__?: {
      invocations: InvokeRecord[];
      snapshot(): {
        activeNoteId: string;
        notes: NoteFixture[];
        invocations: InvokeRecord[];
      };
    };
  }
}

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
const historyLabels = new Map<string, string>();
const clearedHistoryNoteIds = new Set<string>();
let forgottenNotes = [
  {
    kind: 'note',
    title: 'Forgotten draft',
    fileName: 'Forgotten draft.md',
    originalPath: '/e2e/Forgotten draft.md',
    forgottenPath: '/e2e/.forgotten/forgotten-draft',
    forgottenAtMillis: 1_799_000_000_000,
    purgeAfterDays: 30,
    purgeAtMillis: 1_801_592_000_000
  }
];
let historyStorage = { allocatedBytes: 16_384, reclaimableBytes: 512 };

const semanticStatus = {
  settings: {
    semanticSearchEnabled: false,
    lexicalWeight: 1,
    semanticWeight: 0
  },
  model: {
    id: 'e2e-disabled',
    label: 'Disabled in E2E',
    dimensions: 0,
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

function historyHealth() {
  return {
    state: 'healthy',
    integrity: 'verified',
    initialization: {
      phase: 'complete',
      discoveredNotes: notes.size,
      baselineRevisions: notes.size,
      readyNotes: notes.size,
      failedNotes: 0,
      lastError: null
    },
    storage: historyStorage,
    pendingRepairs: 0,
    canRetry: false,
    canReset: false,
    lastReset: null
  };
}

function vaultInfo() {
  return {
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
  };
}

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

function historyRecords(note: NoteFixture) {
  const now = 1_800_000_000_000;
  if (clearedHistoryNoteIds.has(note.noteId)) {
    return [
      {
        kind: 'revision',
        recordId: `${note.noteId}-baseline-after-clear`,
        revisionId: `${note.noteId}-baseline-after-clear`,
        source: 'baselineInitialization',
        occurredAtMillis: now + 60_000,
        timelineOrdinal: 0,
        timeKind: 'knownSince',
        modifiedAtMillis: null,
        editingSessionId: `${note.noteId}-baseline-after-clear`,
        revisionLabel: null,
        lineCount: note.markdown.split('\n').length,
        characterCount: note.markdown.length
      }
    ];
  }
  const revisions = Array.from({ length: 35 }, (_, index) => {
    const ordinal = 35 - index;
    const source = ordinal === 35 ? 'editor' : ordinal % 6 === 0 ? 'externalEdit' : 'editor';
    const sessionOrdinal =
      source === 'externalEdit' ? ordinal : ordinal - ((ordinal - 1) % 6);
    return {
      kind: 'revision',
      recordId: `${note.noteId}-revision-${ordinal}`,
      revisionId: `${note.noteId}-revision-${ordinal}`,
      source,
      occurredAtMillis: now - index * 60_000,
      timelineOrdinal: ordinal,
      timeKind: ordinal % 6 === 0 ? 'observed' : 'committed',
      modifiedAtMillis: ordinal % 6 === 0 ? now - index * 60_000 - 5_000 : null,
      editingSessionId: `${note.noteId}-revision-${sessionOrdinal}`,
      revisionLabel: historyLabels.get(`${note.noteId}-revision-${ordinal}`) ?? null,
      lineCount: ordinal === 35 ? 80 : 3,
      characterCount: ordinal === 35 ? note.markdown.length : 78
    };
  });
  return [
    ...revisions.slice(0, 5),
    {
      kind: 'lifecycleEvent',
      recordId: `${note.noteId}-title-only-rename`,
      eventId: `${note.noteId}-title-only-rename`,
      eventKind: 'renamed',
      occurredAtMillis: now - 5.5 * 60_000,
      timelineOrdinal: 30,
      previousPath: '/e2e/Alpha old.md',
      path: note.path
    },
    ...revisions.slice(5),
    {
      kind: 'lifecycleEvent',
      recordId: `${note.noteId}-created`,
      eventId: `${note.noteId}-created`,
      eventKind: 'created',
      occurredAtMillis: now - 36 * 60_000,
      timelineOrdinal: 0,
      previousPath: null,
      path: note.path
    }
  ];
}

function historicalRevision(note: NoteFixture, revisionId: string) {
  if (revisionId === `${note.noteId}-baseline-after-clear`) {
    return { revisionId, unmanagedFrontmatter: null, body: note.markdown };
  }
  const ordinal = Number(revisionId.split('-').at(-1));
  const fixture = {
    29: { unmanagedFrontmatter: null, body: 'Deleted to create an empty note.\n' },
    30: { unmanagedFrontmatter: 'project: empty\n', body: '' },
    32: {
      unmanagedFrontmatter: 'project: atlas\n',
      body: 'Kept\nRemoved\n*old formatting*\n'
    },
    33: {
      unmanagedFrontmatter: 'project: zeus\n',
      body: 'Kept\nInserted\n**new formatting**\n'
    }
  }[ordinal];
  return {
    revisionId,
    unmanagedFrontmatter:
      fixture?.unmanagedFrontmatter ?? (ordinal % 5 === 0 ? 'fixture: browser-e2e\n' : null),
    body: fixture
      ? fixture.body
      : ordinal === 35
        ? note.markdown
        : `Historical revision ${ordinal} of ${note.title}\n\nThis content is read only.${ordinal === 34 ? '\n\n![[missing-diagram.png]]' : ''}`
  };
}

function historicalDiff(
  note: NoteFixture,
  revisionId: string,
  comparison: 'parent' | 'current'
) {
  if (revisionId === `${note.noteId}-baseline-after-clear`) {
    return {
      revisionId,
      comparison,
      fromRevisionId: null,
      toRevisionId: revisionId,
      bodyLines: [
        {
          kind: 'added',
          text: note.markdown,
          oldLineNumber: null,
          newLineNumber: 1
        }
      ],
      propertiesLines: [],
      missingAssets: []
    };
  }
  const ordinal = Number(revisionId.split('-').at(-1));
  const selected = historicalRevision(note, revisionId);
  const compared =
    comparison === 'parent'
      ? ordinal > 1
        ? historicalRevision(note, `${note.noteId}-revision-${ordinal - 1}`)
        : { revisionId: null, unmanagedFrontmatter: null, body: '' }
      : historicalRevision(note, `${note.noteId}-revision-35`);
  const sameBody = compared.body === selected.body;
  const sameProperties = compared.unmanagedFrontmatter === selected.unmanagedFrontmatter;
  const bodyFrom = comparison === 'parent' ? compared.body : selected.body;
  const bodyTo = comparison === 'parent' ? selected.body : compared.body;
  const propertiesFrom =
    comparison === 'parent'
      ? compared.unmanagedFrontmatter ?? ''
      : selected.unmanagedFrontmatter ?? '';
  const propertiesTo =
    comparison === 'parent'
      ? selected.unmanagedFrontmatter ?? ''
      : compared.unmanagedFrontmatter ?? '';
  return {
    revisionId,
    comparison,
    fromRevisionId: comparison === 'parent' ? compared.revisionId : revisionId,
    toRevisionId: comparison === 'parent' ? revisionId : compared.revisionId,
    bodyLines: sameBody && selected.body
      ? [
          {
            kind: 'context',
            text: selected.body,
            oldLineNumber: 1,
            newLineNumber: 1
          }
        ]
      : [
          ...(bodyFrom
            ? [{
            kind: 'removed',
            text: bodyFrom,
            oldLineNumber: 1,
            newLineNumber: null
          }]
            : []),
          ...(bodyTo
            ? [{
            kind: 'added',
            text: bodyTo,
            oldLineNumber: null,
            newLineNumber: 1
          }]
            : [])
        ],
    propertiesLines: sameProperties
      ? []
      : [
          ...(propertiesFrom
            ? [{
            kind: 'removed',
            text: propertiesFrom,
            oldLineNumber: 1,
            newLineNumber: null
          }]
            : []),
          ...(propertiesTo
            ? [{
            kind: 'added',
            text: propertiesTo,
            oldLineNumber: null,
            newLineNumber: 1
          }]
            : [])
        ],
    missingAssets: ordinal === 34 ? ['missing-diagram.png'] : []
  };
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
        vault: vaultInfo(),
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
    if (command === 'get_note_history_page') {
      const note = notes.get(String(args.noteId ?? ''));
      if (!note) throw new Error('Unknown Note Identity');
      const records = historyRecords(note);
      const cursor = typeof args.cursor === 'string' ? args.cursor : null;
      const start = cursor
        ? Math.max(0, records.findIndex((record) => record.recordId === cursor) + 1)
        : 0;
      const limit = Number(args.limit ?? 30);
      const pageRecords = records.slice(start, start + limit);
      return {
        records: pageRecords,
        nextCursor:
          start + pageRecords.length < records.length
            ? pageRecords.at(-1)?.recordId ?? null
            : null
      };
    }
    if (command === 'get_note_history_revision') {
      const note = notes.get(String(args.noteId ?? ''));
      if (!note) throw new Error('Unknown Note Identity');
      return historicalRevision(note, String(args.revisionId ?? ''));
    }
    if (command === 'get_note_history_diff') {
      const note = notes.get(String(args.noteId ?? ''));
      if (!note) throw new Error('Unknown Note Identity');
      return historicalDiff(
        note,
        String(args.revisionId ?? ''),
        args.comparison === 'current' ? 'current' : 'parent'
      );
    }
    if (command === 'name_note_revision') {
      historyLabels.set(String(args.revisionId ?? ''), String(args.label ?? '').trim());
      return null;
    }
    if (command === 'remove_note_revision_name') {
      historyLabels.delete(String(args.revisionId ?? ''));
      return null;
    }
    if (command === 'clear_note_history') {
      if (args.confirmed !== true) throw new Error('Explicit confirmation required');
      const noteId = String(args.noteId ?? '');
      clearedHistoryNoteIds.add(noteId);
      for (const revisionId of historyLabels.keys()) {
        if (revisionId.startsWith(`${noteId}-revision-`)) historyLabels.delete(revisionId);
      }
      return null;
    }
    if (command === 'get_settings_view') {
      return {
        vault: vaultInfo(),
        historyHealth: historyHealth(),
        semanticStatus,
        semanticSettings: semanticStatus.settings,
        semanticDebug: null
      };
    }
    if (command === 'get_history_health') return historyHealth();
    if (command === 'get_note_history_health') {
      const noteId = String(args.noteId ?? '');
      const note = notes.get(noteId);
      return {
        noteId,
        state: note ? 'healthy' : 'unavailable',
        revisionCount: clearedHistoryNoteIds.has(noteId) ? 1 : 2,
        lifecycleEventCount: 0,
        revisionPayloadBytes: note?.markdown.length ?? 0
      };
    }
    if (command === 'list_forgotten_notes') return forgottenNotes;
    if (command === 'delete_forgotten_notes') {
      const deleted = Array.isArray(args.forgottenPaths)
        ? new Set(args.forgottenPaths.map(String))
        : new Set<string>();
      forgottenNotes = forgottenNotes.filter((note) => !deleted.has(note.forgottenPath));
      historyStorage = { allocatedBytes: 16_384, reclaimableBytes: 8_192 };
      return null;
    }
    if (command === 'clear_vault_history') {
      if (args.confirmed !== true) throw new Error('Explicit confirmation required');
      historyStorage = { allocatedBytes: 16_384, reclaimableBytes: 12_288 };
      return null;
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

import { taskDueDate, setTaskLineDueDate } from '$lib/features/tasks/taskDates';
import { createChatControlsFixture } from './chatControlsFixture';
import type { VaultAtlasResponse } from '$lib/types/atlas';
import type { ChatModelCapabilities } from '$lib/features/chat/types';

import type { NoteFixture, InvokeRecord, TauriCallback, BrowserCommandOverrides } from './browserBackendContract';

export function createBrowserE2eBackend(overrides: BrowserCommandOverrides = {}) {
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
const historyRestores = new Map<
  string,
  {
    revisionId: string;
    sourceRevisionId: string;
    unmanagedFrontmatter: string | null;
    body: string;
    previousBody: string;
  }
>();
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
let missingNotes = [
  {
    noteId: 'note-missing',
    path: '/e2e/Missing outline.md',
    title: 'Missing outline',
    fileName: 'Missing outline.md',
    missingAtMillis: 1_800_000_000_000,
    retentionDays: 7,
    purgeAtMillis: 1_800_604_800_000,
    timeline: {
      nextCursor: 'missing-note-page-2',
      records: [
        {
          kind: 'lifecycleEvent',
          recordId: 'note-missing-event-1',
          eventId: 'note-missing-event-1',
          eventKind: 'missing',
          occurredAtMillis: 1_800_000_000_000,
          timelineOrdinal: 2,
          previousPath: null,
          path: '/e2e/Missing outline.md'
        },
        {
          kind: 'revision',
          recordId: 'note-missing-revision-2',
          revisionId: 'note-missing-revision-2',
          source: 'editor',
          occurredAtMillis: 1_799_999_000_000,
          timelineOrdinal: 1,
          timeKind: 'committed',
          modifiedAtMillis: null,
          revisionLabel: null,
          lineCount: 1,
          characterCount: 25
        }
      ]
    }
  }
];
let revisionChatEnabled = false;
let historyStorage = { allocatedBytes: 16_384, reclaimableBytes: 512 };
let forgottenNoteRetentionDays = 7;

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
    runningPath: '/e2e',
    selectedPath: '/e2e',
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
    tags: note.tags ?? [],
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
  const note = (noteId ? notes.get(noteId) : undefined) ?? [...notes.values()].find((note) => note.path === path);
  if (!note) throw new Error('Unknown note identity or path');
  return note;
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
        revisionLabel: null,
        lineCount: note.markdown.split('\n').length,
        characterCount: note.markdown.length
      }
    ];
  }
  const revisions = Array.from({ length: 35 }, (_, index) => {
    const ordinal = 35 - index;
    const source = ordinal === 35 ? 'editor' : ordinal % 6 === 0 ? 'externalEdit' : 'editor';
    return {
      kind: 'revision',
      recordId: `${note.noteId}-revision-${ordinal}`,
      revisionId: `${note.noteId}-revision-${ordinal}`,
      source,
      occurredAtMillis: now - index * 60_000,
      timelineOrdinal: ordinal,
      timeKind: source === 'externalEdit' ? 'observed' : 'editingWindow',
      timeEvidence: source === 'externalEdit' ? {kind: 'observed', version: 1, observedAtMillis: now - index * 60_000, modifiedAtMillis: now - index * 60_000 - 5_000} : {kind: 'editingWindow', version: 1, firstWallMillis: now - index * 60_000 - 30_000, lastWallMillis: now - index * 60_000, minWallMillis: now - index * 60_000 - 30_000, maxWallMillis: now - index * 60_000, clockDiscontinuity: false},
      modifiedAtMillis: ordinal % 6 === 0 ? now - index * 60_000 - 5_000 : null,
      revisionLabel: historyLabels.get(`${note.noteId}-revision-${ordinal}`) ?? null,
      lineCount: ordinal === 35 ? 80 : 3,
      characterCount: ordinal === 35 ? note.markdown.length : 78
    };
  });
  const restore = historyRestores.get(note.noteId);
  return [
    ...(restore
      ? [{
          kind: 'revision',
          recordId: restore.revisionId,
          revisionId: restore.revisionId,
          source: 'versionRestore',
          occurredAtMillis: now + 30_000,
          timelineOrdinal: 36,
          timeKind: 'committed',
          modifiedAtMillis: null,
          revisionLabel: null,
          lineCount: restore.body.split('\n').length,
          characterCount: restore.body.length
        }]
      : []),
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
  if (revisionChatEnabled && revisionId === 'note-beta-revision-2') {
    return { revisionId, unmanagedFrontmatter: null, body: 'removed confidential prose\nBeta body is independent from Alpha.' };
  }
  const restore = historyRestores.get(note.noteId);
  if (restore?.revisionId === revisionId) {
    return {
      revisionId,
      unmanagedFrontmatter: restore.unmanagedFrontmatter,
      body: restore.body
    };
  }
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
        ? restore?.previousBody ?? note.markdown
        : `Historical revision ${ordinal} of ${note.title}\n\nThis content is read only.${ordinal === 34 ? '\n\n![[missing-diagram.png]]' : ''}`
  };
}

function historicalDiff(
  note: NoteFixture,
  revisionId: string,
  comparison: 'parent' | 'current'
) {
  const restore = historyRestores.get(note.noteId);
  if (restore?.revisionId === revisionId) {
    if (comparison === 'current') {
      return {
        revisionId,
        comparison,
        fromRevisionId: revisionId,
        toRevisionId: revisionId,
        bodyLines: [{ kind: 'context', text: restore.body, oldLineNumber: 1, newLineNumber: 1 }],
        propertiesLines: [],
        missingAssets: []
      };
    }
    const previous = historicalRevision(note, `${note.noteId}-revision-35`);
    return {
      revisionId,
      comparison,
      fromRevisionId: `${note.noteId}-revision-35`,
      toRevisionId: revisionId,
      bodyLines: [
        { kind: 'removed', text: previous.body, oldLineNumber: 1, newLineNumber: null },
        { kind: 'added', text: restore.body, oldLineNumber: null, newLineNumber: 1 }
      ],
      propertiesLines: [],
      missingAssets: []
    };
  }
  if (revisionId === `${note.noteId}-baseline-after-clear`) {
    if (comparison === 'current') {
      return {
        revisionId,
        comparison,
        fromRevisionId: revisionId,
        toRevisionId: revisionId,
        bodyLines: [{ kind: 'context', text: note.markdown, oldLineNumber: 1, newLineNumber: 1 }],
        propertiesLines: [],
        missingAssets: []
      };
    }
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


  const callbacks = new Map<number, TauriCallback>();
  const invocations: InvokeRecord[] = [];
  let callbackId = 0;
  let createdNoteCount = 0;
  const listeners = new Map<number, { event: string; handler: number }>();
  let pendingRestore: { promise: Promise<void>; release: () => void } | null = null;
  let activeNote = notes.get('note-alpha')!;
  const pinnedNoteIds = new Set<string>();
  let nextHistoryPageDelayMillis = 0;
  let pendingSave: { release: () => void; promise: Promise<void>; fail: boolean } | null = null;

  const imageAssets = new Map<string, string>();
  let imageSaveFailures = 0;
  let imageSaveDelay = 0;
  const invoke = async (command: string, rawArgs: unknown = {}) => {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    invocations.push({ command, args });
    if (Object.hasOwn(overrides, command)) return overrides[command](args);

    if (command === 'read_image_asset_fingerprint') {
      const asset = imageAssets.get(String(args.fileName));
      if (!asset) throw new Error('Image asset was not found');
      return asset;
    }
    if (command === 'read_image_asset_data_url') {
      const asset = imageAssets.get(String(args.fileName));
      if (!asset) throw new Error('Image asset was not found');
      return asset;
    }
    if (command === 'store_pasted_image') {
      if (imageSaveDelay) await new Promise(resolve => setTimeout(resolve, imageSaveDelay));
      if (imageSaveFailures > 0) { imageSaveFailures--; throw new Error('Image save failed'); }
      const original = String(args.originalName ?? 'pasted.png');
      let fileName = original, suffix = 1;
      while (imageAssets.has(fileName)) fileName = original.replace(/(\.[^.]+)$/, ` ${suffix++}$1`);
      const bytes = args.bytes as number[];
      imageAssets.set(fileName, `data:${args.mimeType ?? 'image/png'};base64,${btoa(String.fromCharCode(...bytes))}`);
      return { fileName, filePath: `/browser-vault/assets/${fileName}` };
    }

    if (command === 'get_vault_atlas') {
      return {
        status: 'ready', reason: null, revision: 1, generatedAtMillis: 1,
        structuralGeneration: 'browser-map', labelGeneration: null,
        publishedAtMillis: 1, stale: false, publishInProgress: false,
        nodes: [...notes.values()].map((note, index) => ({
          id: note.noteId, noteId: note.noteId, notePath: note.path,
          title: note.title, fileName: note.path.split('/').at(-1)!, documentKind: 'note',
          x: index === 0 ? -200 : 200, y: 0, radius: 5,
          cloudId: null, parentCloudId: null, childCloudId: null,
          clusterId: null, subclusterId: null, centrality: 0, importance: 0,
          lastViewedAtMillis: null, createdAtMillis: 1, updatedAtMillis: 1,
          preview: note.markdown.slice(0, 80), tags: note.tags ?? [], isolated: true
        })),
        links: [], clouds: []
      } satisfies VaultAtlasResponse;
    }

    if (command === 'list_tasks' || command === 'get_task_group' || command === 'set_task_due_date') {
      let changedNoteId: string | null = null;
      if (command === 'set_task_due_date') {
        const [noteId, lineNumber] = String(args.taskId).split(':line:');
        const note = notes.get(noteId);
        if (!note) throw new Error('Task not found');
        const lines = note.markdown.split('\n');
        const index = Number(lineNumber) - 1;
        if (!/^\s*[-*+]\s+\[[ xX]\]/.test(lines[index])) throw new Error('Task changed');
        lines[index] = setTaskLineDueDate(lines[index], args.dueDate === null ? null : String(args.dueDate));
        note.markdown = lines.join('\n');
        changedNoteId = noteId;
      }
      const groups = [...notes.values()].map((note) => {
        const displayTasks = note.markdown.split('\n').flatMap((line, index) => {
          const match = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
          if (!match) return [];
          const completed = match[2].toLowerCase() === 'x';
          if ((args.filter === 'open' && completed) || (args.filter === 'completed' && !completed)) return [];
          return [{ noteId: note.noteId, notePath: note.path, taskId: `${note.noteId}:line:${index + 1}`, taskKey: `${note.noteId}:line:${index + 1}`, noteTitle: note.title, fileName: note.path.split('/').at(-1), text: match[3], dueDate: taskDueDate(match[3]), completed, depth: Math.floor(match[1].length / 2), hidden: false, noteHidden: false, noteCollapsed: false, sectionLabel: null, lineNumber: index + 1, editorLineNumber: index + 1, createdAtMillis: 0, updatedAtMillis: 0 }];
        });
        return { noteId: note.noteId, notePath: note.path, noteTitle: note.title, fileName: note.path.split('/').at(-1), noteHidden: false, noteCollapsed: false, displayTasks, displayCount: displayTasks.length, hiddenCount: 0, visibleCount: displayTasks.length };
      }).filter((group) => group.displayCount > 0);
      if (command === 'list_tasks') return groups;
      const noteId = changedNoteId ?? String(args.noteId);
      return { noteId, notePath: notes.get(noteId)?.path, group: groups.find((group) => group.noteId === noteId) ?? null };
    }
    if (command === 'bootstrap_app') {
      return {
        vault: vaultInfo(),
        noteSession: session(activeNote),
        semanticStatus,
        indexRevision: 1
      };
    }
    if (command === 'get_history_readiness') {
      return { scope: 'browser-fixture', revision: 0, noteId: args.noteId ?? null,
        state: pendingSave ? 'targetVerificationPending' : 'ready', verifiedNotes: pendingSave ? 0 : notes.size, totalNotes: notes.size,
        backgroundComplete: !pendingSave, backgroundUnavailable: false };
    }
    if (command === 'finalize_note_editing_window') { findNote(args); return null; }
    if (command === 'get_last_chat_location') return null;
    if (command === 'plugin:window|theme') return 'light';
    if (command === 'load_note_session') return session(activeNote);
    if (command === 'open_note' || command === 'read_note') {
      const note = findNote(args);
      if (command === 'open_note') activeNote = note;
      return session(note);
    }
    if (command === 'list_note_tags') return [...new Set([...notes.values()].flatMap((note) => note.tags ?? []))].sort();
    if (command === 'save_note' || command === 'save_task_note') {
      const target = args.currentPath == null
        ? { noteId: `note-created-${++createdNoteCount}`, path: `/e2e/created-${createdNoteCount}.md`, title: '', markdown: '' }
        : findNote({ path: args.currentPath });
      const held = pendingSave;
      if (held) {
        await held.promise;
        // save_note/save_task_note reject with String, unlike History commands.
        if (held.fail) throw 'History is unavailable. Retry history from Settings.';
      }
      const saved: NoteFixture = {
        ...target,
        ...(args.tagEdit ? { tags: [...(args.tagEdit as { tags: string[] }).tags] } : {}),
        title: String(args.title ?? target.title),
        markdown: String(args.markdown ?? target.markdown)
      };
      notes.set(saved.noteId, saved);
      if (activeNote.noteId === saved.noteId || args.currentPath == null) activeNote = saved;
      return session(saved);
    }
    if (revisionChatEnabled && command === 'chat_get_composer_draft') return '';
    if (revisionChatEnabled && command === 'chat_get_settings') return {
      provider: 'openai', model: 'fixture-model', defaultAccess: 'full'
    };
    if (revisionChatEnabled && command === 'chat_get_model_capabilities') return {
      images: false, audio: false, video: false, files: false,
      acceptedMimeTypes: [], tools: true
    } satisfies ChatModelCapabilities;
    if (revisionChatEnabled && (command === 'chat_list_conversations' || command === 'chat_get_conversation')) {
      const summary = { id: 'revision-chat', title: 'Current note activity', access: 'full', status: 'active',
        createdAtMillis: 1_800_000_000_000, updatedAtMillis: 1_800_000_000_000, messageCount: 2, detached: false,
        provider: 'openai', model: 'fixture-model', reasoningEffort: 'medium' };
      if (command === 'chat_list_conversations') return [summary];
      return { ...summary, excerpts: [], messages: [
        { id: 'revision-question', conversationId: summary.id, ordinal: 1, role: 'user', status: 'complete',
          content: 'When was the current Beta text introduced?', part: 1, createdAtMillis: summary.createdAtMillis, sources: [] },
        { id: 'revision-answer', conversationId: summary.id, ordinal: 2, role: 'assistant', status: 'complete',
          content: 'Current text: Beta body is independent from Alpha. [Beta note](revision:note-beta-revision-2)',
          part: 1, createdAtMillis: summary.createdAtMillis, sources: [{
            kind: 'revision', noteId: 'note-beta', notePath: '/e2e/beta.md', title: 'Beta note',
            excerpt: 'Beta body is independent from Alpha.', anchor: 'note-beta-revision-2',
            revision: { noteId: 'note-beta', revisionId: 'note-beta-revision-2', atMillis: 1_799_998_020_000,
              source: 'editor', currentExcerpt: 'Beta body is independent from Alpha.' }
          }] }
      ] };
    }
    if (command === 'get_note_history_context') {
      const noteId = String(args.noteId ?? '');
      const revisionId = String(args.revisionId ?? '');
      const note = notes.get(noteId);
      if (!note) throw { state: 'ineligible' };
      const records = historyRecords(note);
      const anchor = records.findIndex(record => record.kind === 'revision' && record.recordId === revisionId);
      if (anchor < 0) throw { state: 'missing' };
      let start = Math.max(0, anchor - 15);
      let end = Math.min(records.length, start + 31);
      if (typeof args.cursor === 'string') {
        const cursor = JSON.parse(args.cursor);
        if (cursor.noteId !== noteId || cursor.revisionId !== revisionId) throw { state: 'stale' };
        start = cursor.start; end = cursor.end;
      }
      const cursor = (start: number, end: number) => JSON.stringify({ noteId, revisionId, start, end });
      return {
        records: records.slice(start, end).map((record, index) => ({ ...record, timelineOrdinal: anchor - start - index })),
        nextCursor: end < records.length ? cursor(end, Math.min(records.length, end + 31)) : null,
        previousCursor: start > 0 ? cursor(Math.max(0, start - 31), start) : null
      };
    }
    if (command === 'get_note_history_page') {
      if (nextHistoryPageDelayMillis > 0) {
        const delayMillis = nextHistoryPageDelayMillis;
        nextHistoryPageDelayMillis = 0;
        await new Promise((resolve) => setTimeout(resolve, delayMillis));
      }
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
    if (command === 'preview_note_revision_restore') {
      const note = notes.get(String(args.noteId ?? ''));
      if (!note) throw new Error('Unknown Note Identity');
      return {
        ...historicalRevision(note, String(args.revisionId ?? '')),
        currentAuthoredContentHash: `e2e:${note.markdown}`
      };
    }
    if (command === 'restore_note_revision') {
      if (pendingRestore) await pendingRestore.promise;
      if (args.confirmed !== true) throw new Error('Explicit confirmation required');
      const note = notes.get(String(args.noteId ?? ''));
      if (!note) throw new Error('Unknown Note Identity');
      if (args.expectedCurrentAuthoredContentHash !== `e2e:${note.markdown}`) {
        throw new Error('Current authored content changed after this restore preview was created');
      }
      const selected = historicalRevision(note, String(args.revisionId ?? ''));
      const restored = {
        revisionId: `${note.noteId}-version-restore-1`,
        sourceRevisionId: selected.revisionId,
        unmanagedFrontmatter: selected.unmanagedFrontmatter,
        body: selected.body,
        previousBody: note.markdown
      };
      historyRestores.set(note.noteId, restored);
      note.markdown = restored.body;
      activeNote = note;
      return { revisionId: restored.revisionId, session: session(note) };
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
    if (command === 'get_forgotten_note_retention_days') return forgottenNoteRetentionDays;
    if (command === 'set_forgotten_note_retention_days') {
      forgottenNoteRetentionDays = Number(args.retentionDays);
      return null;
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
    if (command === 'list_missing_notes') return missingNotes;
    if (command === 'get_missing_note_history_page') {
      if (
        args.noteId !== 'note-missing' ||
        args.cursor !== 'missing-note-page-2'
      ) {
        throw new Error(
          'Missing Note history continuation is stale or belongs to another Note Timeline'
        );
      }
      return {
        nextCursor: null,
        records: [
          {
            kind: 'revision',
            recordId: 'note-missing-revision-1',
            revisionId: 'note-missing-revision-1',
            source: 'noteCreation',
            occurredAtMillis: 1_799_000_000_000,
            timelineOrdinal: 0,
            timeKind: 'committed',
            modifiedAtMillis: null,
            revisionLabel: 'Before external deletion',
            lineCount: 1,
            characterCount: 20
          }
        ]
      };
    }
    if (command === 'recover_missing_note') {
      const noteId = String(args.noteId ?? '');
      const missing = missingNotes.find((note) => note.noteId === noteId);
      if (!missing) throw new Error('Missing Note is no longer available for recovery');
      const restoredPath = '/e2e/Missing outline Recovered Note.md';
      notes.set(noteId, {
        noteId,
        title: missing.title,
        markdown: 'Retained missing-note body',
        path: restoredPath
      });
      missingNotes = missingNotes.filter((note) => note.noteId !== noteId);
      return { noteId, restoredPath, title: missing.title };
    }
    if (command === 'delete_missing_notes') {
      const deleted = Array.isArray(args.noteIds)
        ? new Set(args.noteIds.map(String))
        : new Set<string>();
      missingNotes = missingNotes.filter((note) => !deleted.has(note.noteId));
      return null;
    }
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
      const tokens = String(args.query ?? '').toLowerCase().split(/\s+/);
      const tagFilters = tokens.filter((token) => token.startsWith('#') || token.startsWith('tag:'))
        .map((token) => token.replace(/^(#|tag:)/, ''));
      const terms = tokens.filter((token) => !token.startsWith('#') && !token.startsWith('tag:'));
      return [...notes.values()]
        .filter((note) => {
          const tags = note.path === args.currentPath && Array.isArray(args.currentTags)
            ? args.currentTags as string[] : note.tags ?? [];
          return tagFilters.every((tag) => tags.includes(tag)) &&
            terms.every((term) => `${note.title}\n${note.markdown}\n${tags.join(' ')}`.toLowerCase().includes(term));
        })
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
    if (command === 'plugin:event|listen') {
      const id = callbackId++;
      listeners.set(id, { event: String(args.event), handler: Number(args.handler) });
      return id;
    }
    if (command === 'plugin:event|unlisten') {
      const id = Number(args.eventId);
      const listener = listeners.get(id);
      if (listener) callbacks.delete(listener.handler);
      listeners.delete(id);
      return null;
    }
    // Explicit empty/no-op capabilities used by the default fixture. Unsupported
    // commands fail so a new production dependency cannot silently pass a journey.
    if (['chat_list_conversations', 'chat_list_archived_conversations', 'list_pending_note_proposals', 'chat_list_pending_proposals', 'chat_list_grants', 'chat_list_note_policies', 'chat_list_openai_models', 'chat_list_local_models'].includes(command)) return [];
    if (command === 'chat_get_settings') return null;
    if (command === 'chat_get_composer_draft') return '';
    if (['remember_note', 'set_last_chat_location', 'chat_set_composer_draft'].includes(command)) return null;
    throw new Error(`Browser fixture does not implement command: ${command}`);
  };

  const internals = {
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

  const bridge = {
    invocations,
    seedChatControls() { Object.assign(overrides, createChatControlsFixture((event, payload) => bridge.emit(event, payload))); },
    emit(event: string, payload: unknown) {
      for (const [id, listener] of [...listeners]) {
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
      }
    },
    holdHistoryRestore() {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      pendingRestore = { promise, release };
    },
    releaseHistoryRestore() { const held = pendingRestore; pendingRestore = null; held?.release(); },
    holdSave(fail = false) {
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      pendingSave = { release, promise, fail };
    },
    releaseSave() { const held = pendingSave; pendingSave = null; held?.release(); },
    seedImageAsset(name: string) {
      imageAssets.set(name, `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#527db5"/><circle cx="600" cy="400" r="180" fill="#eebe56"/></svg>')}`);
    },
    configureImageSave(failures = 0, delayMillis = 0) { imageSaveFailures = failures; imageSaveDelay = delayMillis; },
    seedRevisionChat() { revisionChatEnabled = true; },
    delayNextHistoryPage(delayMillis = 75) {
      nextHistoryPageDelayMillis = delayMillis;
    },
    snapshot() {
      return {
        activeNoteId: activeNote.noteId,
        notes: [...notes.values()].map((note) => ({ ...note })),
        invocations: invocations.map((entry) => ({ ...entry }))
      };
    }
  };
  return { invoke, internals, bridge };
}

export function installBrowserE2eBackend() {
  if (!import.meta.env.DEV || import.meta.env.VITE_E2E_BROWSER !== 'true' || window.__GNEAUXGHTS_E2E__) return;
  const backend = createBrowserE2eBackend(window.__GNEAUXGHTS_E2E_COMMANDS__ ??= {});
  window.__TAURI_INTERNALS__ = backend.internals;
  window.__GNEAUXGHTS_E2E__ = backend.bridge;
}


declare global {
  interface Window { __TAURI_INTERNALS__: Record<string, unknown>; }
}

import { invoke } from '@tauri-apps/api/core';
import { documentHasCleanBuffer, documentHasUnresolvedConflict, getDocumentNoteId, getDocumentPath, type DocumentSavedBaseline, type NoteDraftState } from '../document/documentState';
import type { DocumentBody } from '../document/documentBody';
import type { DraftBackup } from './draftBackup';
export type { DraftBackup } from './draftBackup';

interface Capture extends Omit<DraftBackup, 'markdown' | 'updatedAtMillis' | 'baseline'> { body: DocumentBody; baseline: DocumentSavedBaseline | null }
type Work = { kind: 'save'; capture: Capture } | { kind: 'remove'; id: string; version: number };
interface Entry { capture?: Capture; pending?: Work; error: boolean; backedUpVersion: number }
interface Metadata { id: string; version: number }
// Documents survive route remounts. Reusing their ID and monotonically increasing
// version prevents an old workspace's delayed save from reviving retired work.
const metadata = new WeakMap<NoteDraftState, Metadata>();

interface RecoveryDeps {
  getDocuments: () => Iterable<NoteDraftState>;
  recover: (backup: DraftBackup) => Promise<NoteDraftState>;
  save?: (draft: DraftBackup) => Promise<unknown>;
  list?: () => Promise<DraftBackup[]>;
  remove?: (id: string, version: number) => Promise<unknown>;
  createId?: () => string;
  /** Title fields commit on blur; recovery also retains their current typed value. */
  readTitle?: (document: NoteDraftState) => string;
}

export class DraftRecoveryController {
  backups = $state<DraftBackup[]>([]);
  isLoading = $state(false);
  resumingId = $state<string | null>(null);
  loadError = $state<string | null>(null);
  backupError = $state<string | null>(null);
  actionError = $state<string | null>(null);
  #entries = new Map<string, Entry>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #maxTimer: ReturnType<typeof setTimeout> | null = null;
  #writing: Promise<void> | null = null;
  #loadRevision = 0;
  #retired = new Map<string, number>();
  #resumedDocuments = new Map<string, NoteDraftState>();
  #disposed = false;
  #save: NonNullable<RecoveryDeps['save']>;
  #list: NonNullable<RecoveryDeps['list']>;
  #remove: NonNullable<RecoveryDeps['remove']>;

  constructor(private readonly deps: RecoveryDeps) {
    this.#save = deps.save ?? (draft => invoke('save_draft_backup', { draft }));
    this.#list = deps.list ?? (() => invoke<DraftBackup[]>('list_draft_backups'));
    this.#remove = deps.remove ?? ((id, version) => invoke('remove_draft_backup', { id, version }));
  }

  #metadata(document: NoteDraftState) {
    let value = metadata.get(document);
    if (!value) { value = { id: this.deps.createId?.() ?? crypto.randomUUID(), version: 0 }; metadata.set(document, value); }
    return value;
  }

  #title(document: NoteDraftState) { return this.deps.readTitle?.(document) ?? document.working.title; }
  #clean(document: NoteDraftState) { return documentHasCleanBuffer(document) && this.#title(document) === document.working.title; }

  track = (document: NoteDraftState) => {
    if (this.#clean(document)) { this.onSaved(document); return; }
    const identity = this.#metadata(document);
    let entry = this.#entries.get(identity.id);
    if (!entry) { entry = { error: false, backedUpVersion: 0 }; this.#entries.set(identity.id, entry); }
    const old = entry.capture;
    const working = document.working;
    const title = this.#title(document);
    const tags = working.tags ?? [];
    const sourceNoteId = getDocumentNoteId(document), sourcePath = getDocumentPath(document);
    // An unresolved conflict must remain a conflict after another interruption.
    const baseline = documentHasUnresolvedConflict(document) ? null : document.savedBaseline;
    if (old && old.body === working.body && old.title === title && old.baseline === baseline && old.tagsError === (working.tagsError ?? null) &&
      old.tags.length === tags.length && old.tags.every((tag, index) => tag === tags[index]) &&
      old.sourceNoteId === sourceNoteId && old.sourcePath === sourcePath && entry.pending?.kind !== 'remove') return;
    const capture: Capture = { id: identity.id, version: ++identity.version, title, body: working.body,
      tags: [...tags], tagsError: working.tagsError ?? null, sourceNoteId, sourcePath, baseline };
    entry.capture = capture;
    entry.pending = { kind: 'save', capture };
    this.#schedule();
  };

  /** Called only after canonical adoption; newer dirty edits keep their backup. */
  onSaved = (document: NoteDraftState) => {
    if (!this.#clean(document)) return;
    const identity = metadata.get(document);
    if (!identity) return;
    const existing = this.#entries.get(identity.id);
    if (existing && !existing.capture && (!existing.pending || existing.pending.kind === 'remove')) return;
    const entry = existing ?? { error: false, backedUpVersion: 0 };
    entry.capture = undefined;
    entry.pending = { kind: 'remove', id: identity.id, version: ++identity.version };
    this.#entries.set(identity.id, entry);
    this.#schedule();
  };

  #schedule() {
    if (this.#disposed) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.#clearTimers(); void this.#drain(); }, 400);
    this.#maxTimer ??= setTimeout(() => { this.#clearTimers(); void this.#drain(); }, 2000);
  }

  #clearTimers() {
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#maxTimer) clearTimeout(this.#maxTimer);
    this.#timer = this.#maxTimer = null;
  }

  #drain(): Promise<void> {
    if (this.#writing) return this.#writing;
    const failed = new Set<Entry>();
    const run = async () => {
      while (true) {
        const entry = [...this.#entries.values()].find(entry => entry.pending && !failed.has(entry));
        if (!entry?.pending) break;
        const work = entry.pending;
        entry.pending = undefined;
        try {
          if (work.kind === 'save') {
            const { body, baseline, ...fields } = work.capture;
            await this.#save({ ...fields, markdown: body.toMarkdown(), baseline: baseline ? {
              title: baseline.content.title, markdown: baseline.content.body.toMarkdown(),
              tags: [...(baseline.content.tags ?? [])], tagsError: baseline.content.tagsError ?? null
            } : null, updatedAtMillis: 0 });
            entry.backedUpVersion = Math.max(entry.backedUpVersion, work.capture.version);
          } else {
            await this.#remove(work.id, work.version);
            this.#retired.set(work.id, work.version);
            this.backups = this.backups.filter(backup => backup.id !== work.id);
          }
          entry.error = false;
        } catch {
          const newerPending = entry.pending;
          entry.pending ??= work;
          entry.error = true;
          if (!newerPending) failed.add(entry);
        }
      }
      this.backupError = [...this.#entries.values()].some(entry => entry.error)
        ? 'Recovery backup could not be saved. Your note save can still continue.' : null;
    };
    this.#writing = run().finally(() => { this.#writing = null; });
    return this.#writing;
  }

  /** Backup failures remain visible but never reject the canonical save barrier. */
  flushAll = async () => {
    for (const document of this.deps.getDocuments()) this.track(document);
    this.#clearTimers();
    await this.#drain();
    if ([...this.#entries.values()].some(entry => entry.pending && !entry.error)) await this.#drain();
  };

  retry = async () => { this.#clearTimers(); await this.#drain(); };

  load = async () => {
    const revision = ++this.#loadRevision;
    this.isLoading = true; this.loadError = null;
    try {
      const backups = await this.#list();
      if (this.#disposed || revision !== this.#loadRevision) return;
      const active = new Set([...this.deps.getDocuments()].map(document => metadata.get(document)?.id));
      this.backups = backups.filter(backup => !active.has(backup.id) && (this.#retired.get(backup.id) ?? 0) < backup.version);
    } catch { if (!this.#disposed && revision === this.#loadRevision) this.loadError = 'Recoverable work could not be loaded.'; }
    finally { if (revision === this.#loadRevision) this.isLoading = false; }
  };

  resume = async (backup: DraftBackup) => {
    if (this.resumingId) return;
    this.resumingId = backup.id; this.actionError = null;
    try {
      let document = this.#resumedDocuments.get(backup.id);
      if (!document) {
        document = await this.deps.recover(backup);
        if (backup.sourceNoteId ? getDocumentNoteId(document) !== backup.sourceNoteId
          : getDocumentPath(document) || getDocumentNoteId(document)) throw new Error('Recovery opened a different note.');
        this.#resumedDocuments.set(backup.id, document);
      }
      this.track(document);
      this.#clearTimers();
      await this.#drain();
      const identity = metadata.get(document);
      const entry = identity && this.#entries.get(identity.id);
      if (!this.#clean(document) && (!entry?.capture || entry.backedUpVersion < entry.capture.version || entry.error)) {
        throw new Error('The recovered work is not backed up yet. The previous backup remains available.');
      }
      await this.discard(backup);
    } catch { this.actionError = 'Recovery could not complete. Your unfinished work is still available. Open the original note or retry recovery.'; }
    finally { this.resumingId = null; }
  };

  discard = async (backup: DraftBackup) => {
    this.actionError = null;
    try {
      const version = Math.max(backup.version + 1, (this.#retired.get(backup.id) ?? 0) + 1);
      await this.#remove(backup.id, version);
      this.#retired.set(backup.id, version);
      this.#resumedDocuments.delete(backup.id);
      this.backups = this.backups.filter(item => item.id !== backup.id);
    } catch { this.actionError = 'Could not remove this recovery backup. Try again.'; }
  };

  dispose() {
    this.#disposed = true; this.#loadRevision += 1; this.#clearTimers();
    void this.flushAll();
  }
}

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { $, $$, browser } from '@wdio/globals';
import type { ConversationId, TaskId } from '@earendil-works/pi-durable';
import type { AuthoritySnapshot } from '../../../src/lib/features/chat/pi/authority';
import type { PreparedMutation, PublicationIntent, PublicationTaskResult } from '../../../src/lib/features/chat/pi/publication';
import type { PiChat, PI_CONTEXT } from '../../../src/lib/features/chat/pi/runtime';
import type { HistoryModePage } from '../../../src/lib/features/history/historyModeMachine';
import { invokeNative } from '../../support/liveNative';
import { activatePiEditor, assertDisposable, configurePi, messages, newPiConversation, observePi, openPiPane, paneState, savePiFixtureNote, sendPiMessage, startPiProviderFixture, waitPiIdle } from '../../support/piChatAcceptance';

type EditorHost = Window & {
  __GNEAUXGHTS_NATIVE_E2E__?: {
    piChat(): Promise<PiChat>;
    piContext(): Promise<typeof PI_CONTEXT> | typeof PI_CONTEXT;
    piPublicationTask(): Promise<typeof import('../../../src/lib/features/chat/pi/publication').PublicationTask>;
    readEditorState(): { noteId: string | null; workspaceOperationPending: boolean; editor: { markdown: string } | null };
    setEditorSelection(anchor: number, head: number): boolean;
  };
  __PI_RENAME_READ_FAILURE__?: { committed: boolean; failedReads: number; failedProofs: number; proofUnavailable: boolean; publicationCalls: number; reconciliationCalls: number; restore(): void };
};

/** Synthetic model protocol, real note reads, review, publication and filesystem. */
describe('Pi same-folder filename editing', function () {
  this.timeout(180_000);
  let provider: Awaited<ReturnType<typeof startPiProviderFixture>>;
  before(async () => { provider = await startPiProviderFixture(); await configurePi(provider.endpoint, provider.model); });
  after(async () => { await provider?.close(); });

  async function setup(title: string, folder?: string) {
    const markdown = '---\nproject: observatory\n---\n\nAn unchanged note with a literal \\[path\\] and a task.\n\n- [ ] Arrange telescope';
    let note: Awaited<ReturnType<typeof savePiFixtureNote>>;
    if (folder) {
      // Create a canonical nested fixture through the existing Pi creation owner.
      // An absent currentPath is not an existing editor baseline, and separate
      // watcher delete/create batches would test external relocation instead.
      const vault = realpathSync(join(await assertDisposable(), 'documents/vault'));
      const directory = join(vault, folder); mkdirSync(directory, { recursive: true });
      await openPiPane(); await observePi(); await newPiConversation();
      await $('[aria-label="Vault access"]').click();
      await $('button[role="menuitemradio"]*=Allow edits in this chat').click();
      await browser.waitUntil(async () => (await paneState()).authority?.write.grant.duration === 'temporary');
      await $('[aria-label="Vault access"]').click();
      await $('button[role="menuitemcheckbox"]*=Allow creating new notes').click();
      await browser.waitUntil(async () => {
        const grant = (await paneState()).authority?.write.grant;
        return grant?.duration !== 'off' && grant?.operations.includes('create');
      });
      if (!(await paneState()).authority?.write.reviewBeforeApplying) {
        await $('[aria-label="Vault access"]').click();
        await $('button[role="menuitemcheckbox"]*=Review before applying edits').click();
        await browser.waitUntil(async () => (await paneState()).authority?.write.reviewBeforeApplying === true);
      }
      provider.setCreate({ title, markdown, folder });
      await submitted(`fixture-create: canonical nested rename source ${title}`);
      await $('[data-testid="pi-edit-review"]').waitForDisplayed({ timeout: 30_000 });
      await $('button=Create note').click();
      const pane = await waitPiIdle();
      const created = messages(pane).find(message => message.role === 'toolResult' && message.toolName === 'create_note');
      assert(created?.role === 'toolResult');
      const result = JSON.parse(created.content.filter(block => block.type === 'text').map(block => block.text).join(''));
      assert.equal(result.status, 'committed');
      note = await invokeNative<typeof note>('read_note', { noteId: result.noteId, path: null });
      const read = await invokeNative<{ noteId: string; path: string }>('read_note', { noteId: note.noteId, path: null });
      assert.equal(read.noteId, note.noteId); assert.equal(read.path, note.path);
      assert.equal(dirname(note.path), directory);
    } else note = await savePiFixtureNote(title, markdown);
    await invokeNative('mark_note_opened', { noteId: note.noteId });
    await browser.refresh();
    await browser.waitUntil(async () => await $('[data-testid="note-title"]').getValue() === title, { timeout: 30_000 });
    await openPiPane(); await observePi(); await newPiConversation();
    return { ...note, raw: readFileSync(note.path, 'utf8') };
  }
  async function grantEditing() {
    await $('[aria-label="Vault access"]').click();
    await $('button[role="menuitemradio"]*=Allow edits in this chat').click();
    await browser.waitUntil(async () => (await paneState()).authority?.write.grant.duration === 'temporary');
    const write = (await paneState()).authority!.write;
    assert(write.grant.duration !== 'off'); assert.deepEqual(write.grant.operations, ['update']);
    if (!write.reviewBeforeApplying) {
      await $('[aria-label="Vault access"]').click();
      await $('button[role="menuitemcheckbox"]*=Review before applying edits').click();
      await browser.waitUntil(async () => (await paneState()).authority?.write.reviewBeforeApplying === true);
    }
  }
  async function submitted(prompt: string) {
    await sendPiMessage(prompt);
    await browser.waitUntil(async () => messages(await paneState()).some(message => message.role === 'user' && JSON.stringify(message.content).includes(prompt)));
  }
  async function requestRename(note: { noteId: string; path: string }, title: string, suffix = '') {
    provider.setRename({ noteId: note.noteId, title });
    await submitted(`fixture-rename${suffix}: rename the saved note, preserving all content.`);
    await $('[data-testid="pi-edit-review"]').waitForDisplayed({ timeout: 30_000 });
    return join(dirname(note.path), `${title}.md`);
  }

  it('uses editing permission for renames and honors the shared review setting', async () => {
    const note = await setup('Pi rename permission source');
    const destination = join(dirname(note.path), 'Pi rename permission destination.md');
    provider.setRename({ noteId: note.noteId, title: 'Pi rename permission destination' });
    await submitted('fixture-rename with editing off'); await waitPiIdle();
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);
    assert.equal(readFileSync(note.path, 'utf8'), note.raw); assert.equal(existsSync(destination), false);
    await grantEditing();
    await $('[aria-label="Vault access"]').click();
    assert.equal(await $('button[role="menuitemcheckbox"]*=Allow renaming notes').isExisting(), false);
    await $('button[role="menuitemcheckbox"]*=Review before applying edits').click();
    await browser.waitUntil(async () => (await paneState()).authority?.write.reviewBeforeApplying === false);
    await submitted('fixture-rename under unified editing permission with review off'); await waitPiIdle();
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);
    assert.equal(existsSync(note.path), false); assert.equal(readFileSync(destination, 'utf8'), note.raw);
  });

  it('shows exact paths and link semantics, then discards without changing either location', async () => {
    const note = await setup('Pi discarded filename source'); await grantEditing();
    const destination = await requestRename(note, 'Pi discarded filename destination');
    const review = await $('[data-testid="pi-edit-review"]');
    const text = await review.getText();
    assert(text.includes(basename(note.path)) && text.includes(basename(destination)) && text.includes('→'));
    assert(text.includes('content and properties stay unchanged'));
    assert(text.includes('Filename and path links may stop resolving') && text.includes('backlinks will not be changed'));
    if (process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT)
      await review.saveScreenshot(join(process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT, 'pi-rename-exact-review.png'));
    assert.equal(readFileSync(note.path, 'utf8'), note.raw); assert.equal(existsSync(destination), false);
    await $('button=Discard rename').click(); await waitPiIdle();
    assert.equal(readFileSync(note.path, 'utf8'), note.raw); assert.equal(existsSync(destination), false);
    assert.equal(await $('[data-testid="note-title"]').getValue(), note.title);
  });

  it('rejects an already occupied destination without offering an unreviewed suffix', async () => {
    const note = await setup('Pi occupied filename source'); await grantEditing();
    const destination = join(dirname(note.path), 'Pi occupied filename destination.md');
    const foreign = 'An existing destination must be preserved exactly.\n';
    writeFileSync(destination, foreign, { flag: 'wx' });
    provider.setRename({ noteId: note.noteId, title: 'Pi occupied filename destination' });
    await submitted('fixture-rename to an already occupied exact destination'); await waitPiIdle();
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);
    assert.equal(readFileSync(note.path, 'utf8'), note.raw); assert.equal(readFileSync(destination, 'utf8'), foreign);
    assert.equal(existsSync(join(dirname(note.path), 'Pi occupied filename destination (2).md')), false);
  });

  it('includes descendant folders in the shared write scope without an extra rename grant', async () => {
    const note = await setup('Pi nested filename source', 'Projects/Ideas'); await grantEditing();
    const destination = join(dirname(note.path), 'Pi nested filename destination.md');
    await $('[aria-label="Vault access"]').click();
    await $('button[role="menuitem"]=Allowed write folders…').click();
    await $('textarea[aria-label="Allowed write folders"]').setValue('Projects');
    await $('button=Save folders').click();
    await browser.waitUntil(async () => {
      const grant = (await paneState()).authority?.write.grant;
      return grant?.duration !== 'off' && grant?.scope.folders.length === 1 && grant.scope.folders[0] === 'Projects';
    });
    await requestRename(note, 'Pi nested filename destination');
    const text = await $('[data-testid="pi-edit-review"]').getText();
    assert(text.includes(`Projects/Ideas/${basename(note.path)}`) && text.includes(`Projects/Ideas/${basename(destination)}`));
    await $('button=Rename note').click(); await waitPiIdle();
    assert.equal(existsSync(note.path), false); assert.equal(readFileSync(destination, 'utf8'), note.raw);
    assert.equal(existsSync(join(dirname(dirname(note.path)), basename(destination))), false, 'Rename must stay in its current folder');
  });

  it('renames only after review, retains bytes and identity, and opens an earlier source citation', async () => {
    const note = await setup('Pi reviewed filename source'); await grantEditing();
    const history = () => invokeNative<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    const before = await history();
    const destination = await requestRename(note, 'Pi reviewed filename destination', '-historical');
    assert.equal(readFileSync(note.path, 'utf8'), note.raw); assert.equal(existsSync(destination), false);
    await $('button=Rename note').click();
    const pane = await waitPiIdle();
    assert.equal(existsSync(note.path), false); assert.equal(readFileSync(destination, 'utf8'), note.raw);
    await browser.waitUntil(async () => await $('[data-testid="note-title"]').getValue() === 'Pi reviewed filename destination');
    const current = await invokeNative<{ noteId: string; path: string }>('read_note', { noteId: note.noteId, path: null });
    assert.equal(current.noteId, note.noteId); assert.equal(current.path, destination);
    const after = await history();
    assert.deepEqual(after.records.filter(row => row.kind === 'revision'), before.records.filter(row => row.kind === 'revision'), 'A byte-preserving rename must not create an authored revision');
    const renamed = after.records.filter(row => row.kind === 'lifecycleEvent' && row.eventKind === 'renamed' && !before.records.some(previous => previous.recordId === row.recordId));
    assert.equal(renamed.length, 1);
    const foreign = 'A foreign replacement now occupies the retired filename.\n';
    writeFileSync(note.path, foreign, { flag: 'wx' });
    await invokeNative('e2e_flush_vault_watcher_path', { path: note.path });
    const hinted = await invokeNative<{ noteId: string; path: string }>('read_note', { noteId: note.noteId, path: note.path });
    assert.equal(hinted.noteId, note.noteId); assert.equal(hinted.path, destination, 'Retained identity must win over a foreign file at the old path');
    const read = messages(pane).find(message => message.role === 'toolResult' && message.toolName === 'read_note');
    assert(read?.role === 'toolResult');
    const sourceId = JSON.parse(read.content.filter(block => block.type === 'text').map(block => block.text).join('')).source.sourceId;
    await $('[data-pane-kind="editor"] button[aria-label="Close pane"]').click();
    await browser.waitUntil(async () => (await $$('[data-pane-kind="editor"]')).length === 0);
    await $(`[data-testid="pi-assistant-message"] [data-pi-source="${sourceId}"]`).click();
    await browser.waitUntil(async () => await $('[data-testid="note-title"]').getValue() === 'Pi reviewed filename destination');
    await activatePiEditor();
    const opened = await browser.execute(() => (window as EditorHost).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState());
    assert.equal(opened.noteId, note.noteId);
    assert(opened.editor?.markdown.includes('An unchanged note'));
    assert.equal(readFileSync(note.path, 'utf8'), foreign);
    await assert.rejects(invokeNative('save_note', {
      title: note.title, markdown: 'A stale pre-rename save must not recreate the retired path.',
      currentPath: note.path, expectedNoteId: note.noteId
    }));
    assert.equal(readFileSync(note.path, 'utf8'), foreign); assert.equal(readFileSync(destination, 'utf8'), note.raw);
  });

  it('preserves a destination that appears after the exact review', async () => {
    const note = await setup('Pi raced filename source'); await grantEditing();
    const destination = await requestRename(note, 'Pi raced filename destination');
    const foreign = 'A foreign file created after review; it must survive byte-for-byte.\n';
    writeFileSync(destination, foreign, { flag: 'wx' });
    await $('button=Rename note').click(); await waitPiIdle();
    assert.equal(readFileSync(note.path, 'utf8'), note.raw);
    assert.equal(readFileSync(destination, 'utf8'), foreign);
    assert.equal(await $('[data-testid="note-title"]').getValue(), note.title);
  });

  for (const failure of ['editorRead', 'uncertainProof'] as const) it(`recovers ${failure} through visible Retry without republishing`, async () => {
    const note = await setup(`Pi ${failure} recovery filename source`); await grantEditing();
    const destination = await requestRename(note, `Pi ${failure} recovery filename destination`);
    await browser.execute((noteId: string, destination: string, failure: 'editorRead' | 'uncertainProof') => {
      const host = window as EditorHost, original = window.fetch;
      const state: NonNullable<EditorHost['__PI_RENAME_READ_FAILURE__']> = host.__PI_RENAME_READ_FAILURE__ = {
        committed: false, failedReads: 0, failedProofs: 0, proofUnavailable: true, publicationCalls: 0, reconciliationCalls: 0,
        restore() { window.fetch = original; delete host.__PI_RENAME_READ_FAILURE__; }
      };
      // Tauri's invoke property is immutable. Observe its real fetch transport,
      // forwarding every actual effect; inject a failed readback or lost proof.
      // Return a normal IPC error response so Tauri does not retry via fallback.
      window.fetch = async (input, options) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const command = url.protocol === 'ipc:' ? decodeURIComponent(url.pathname.slice(1)) : '';
        const args = command && typeof options?.body === 'string' ? JSON.parse(options.body) as Record<string, unknown> : undefined;
        if (failure === 'editorRead' && command === 'read_note' && args?.noteId === noteId && args.path === destination && state.committed && state.failedReads === 0) {
          state.failedReads++;
          return new Response(JSON.stringify('One synthetic post-commit editor readback failure.'), {
            headers: { 'content-type': 'application/json', 'Tauri-Response': 'error' }
          });
        }
        if (command === 'pi_chat_publish_mutation') state.publicationCalls++;
        if (command === 'pi_chat_reconcile_mutation') {
          state.reconciliationCalls++;
          if (failure === 'uncertainProof' && state.committed && state.proofUnavailable) {
            state.failedProofs++;
            return new Response(JSON.stringify({ code: 'uncertain_publication', message: 'Synthetic unavailable rename proof.' }), {
              headers: { 'content-type': 'application/json', 'Tauri-Response': 'error' }
            });
          }
        }
        const response = await original.call(window, input, options);
        if (command === 'pi_chat_publish_mutation' && response.headers.get('Tauri-Response') === 'ok') {
          const result = await response.clone().json() as { status?: string };
          if (result.status === 'committed') {
            state.committed = true;
            if (failure === 'uncertainProof') return new Response(JSON.stringify({ code: 'uncertain_publication', message: 'Synthetic lost rename acknowledgement.' }), {
              headers: { 'content-type': 'application/json', 'Tauri-Response': 'error' }
            });
          }
        }
        return response;
      };
    }, note.noteId, destination, failure);
    try {
      await $('button=Rename note').click(); const pane = await waitPiIdle();
      const tool = messages(pane).find(message => message.role === 'toolResult' && message.toolName === 'rename_note');
      assert(tool?.role === 'toolResult');
      const result = JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join(''));
      if (failure === 'editorRead') {
        assert.equal(result.status, 'committed');
        assert(result.commitWarning?.issues.some((issue: { stage: string }) => issue.stage === 'editorAdoption'), 'The injected readback failure must remain a committed editor-adoption warning');
      } else {
        assert.equal(result.status, 'failed'); assert.equal(result.code, 'uncertain_publication');
      }
      assert.equal(existsSync(note.path), false); assert.equal(readFileSync(destination, 'utf8'), note.raw);
      const recovery = await $('[data-testid="pi-publication-recovery"]'); await recovery.waitForDisplayed();
      const retry = await recovery.$(failure === 'editorRead' ? 'button=Retry editor refresh' : 'button=Retry verification');
      assert.equal(await retry.isEnabled(), true);
      const frozen = await browser.execute(() => {
        const stats = (window as EditorHost).__PI_RENAME_READ_FAILURE__!;
        return { editor: Boolean(document.querySelector('[data-pane-kind="editor"]')?.closest('[inert]')),
          retry: Boolean(document.querySelector('[data-testid="pi-publication-recovery"] button')?.closest('[inert]')),
          stats: { failedReads: stats.failedReads, failedProofs: stats.failedProofs, publicationCalls: stats.publicationCalls, reconciliationCalls: stats.reconciliationCalls } };
      });
      assert.equal(frozen.editor, true); assert.equal(frozen.retry, false);
      assert.equal(frozen.stats.failedReads, failure === 'editorRead' ? 1 : 0); assert.equal(frozen.stats.publicationCalls, 1);
      if (failure === 'uncertainProof') {
        assert(frozen.stats.failedProofs > 0);
        await retry.click();
        await browser.waitUntil(async () => browser.execute((previous: number) => {
          const stats = (window as EditorHost).__PI_RENAME_READ_FAILURE__!;
          return stats.failedProofs > previous && document.querySelector('[data-testid="pi-publication-recovery"] button')?.textContent?.trim() === 'Retry verification';
        }, frozen.stats.failedProofs));
        assert.equal(await recovery.isDisplayed(), true);
        assert.equal(await browser.execute(() => Boolean(document.querySelector('[data-pane-kind="editor"]')?.closest('[inert]'))), true);
        await browser.execute(() => { (window as EditorHost).__PI_RENAME_READ_FAILURE__!.proofUnavailable = false; });
      }
      if (process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT)
        await recovery.saveScreenshot(join(process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT, `pi-rename-${failure}-recovery.png`));
      await retry.click();
      await browser.waitUntil(async () => !await recovery.isExisting());
      await browser.waitUntil(async () => await $('[data-testid="note-title"]').getValue() === basename(destination, '.md'));
      const settled = await browser.execute(() => {
        const stats = (window as EditorHost).__PI_RENAME_READ_FAILURE__!;
        return { publicationCalls: stats.publicationCalls, reconciliationCalls: stats.reconciliationCalls,
          frozen: Boolean(document.querySelector('[data-pane-kind="editor"]')?.closest('[inert]')) };
      });
      assert.equal(settled.publicationCalls, 1); assert(settled.reconciliationCalls > frozen.stats.reconciliationCalls);
      assert.equal(settled.frozen, false); assert.equal(readFileSync(destination, 'utf8'), note.raw); assert.equal(existsSync(note.path), false);
    } finally {
      await browser.execute(() => (window as EditorHost).__PI_RENAME_READ_FAILURE__?.restore());
    }
  });

  it('adopts one renamed identity into both existing editor panes without a stale-path save', async () => {
    const note = await setup('Pi two-pane filename source'); await grantEditing();
    // Establish a real conversation, then prepare/approve natively. The app has
    // two visible panes, so the separate model/review journeys above own review
    // presentation; this task runs while both visible panes edit the same note.
    await submitted('Two-pane rename publication setup.'); await waitPiIdle();
    const selected = await paneState(); assert(selected.conversationId && selected.authority);
    const authority = await invokeNative<AuthoritySnapshot>('pi_chat_authority', { authorityId: selected.authority.authorityId });
    const read = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: authority.authorityId, noteId: note.noteId });
    const prepared = await invokeNative<PreparedMutation>('pi_chat_prepare_mutation', { authorityId: authority.authorityId, requestId: `rename-two-pane-${crypto.randomUUID()}`, mutation: { operation: 'rename', noteId: note.noteId, expectedReadSourceId: read.source.sourceId, title: 'Pi two-pane filename destination' } });
    assert.equal(prepared.operation, 'rename');
    if (prepared.operation !== 'rename') throw new Error('Expected a prepared rename.');
    await invokeNative('pi_chat_approve_mutation', { authorityId: authority.authorityId, intentId: prepared.intentId, payloadHash: prepared.payloadHash });
    await $('[data-pane-kind="chat"] button[aria-label="Close pane"]').click();
    await $('[aria-label="Open split pane options"]').click();
    await $('#pane-command-current').click();
    await browser.waitUntil(async () => (await $$('[data-pane-kind="editor"] [data-testid="note-title"]')).length === 2);
    await browser.waitUntil(async () => {
      const editors = await $$('[data-pane-kind="editor"] .cm-content');
      if (editors.length !== 2) return false;
      for (const editor of editors) if (!(await editor.getText()).includes('An unchanged note')) return false;
      return true;
    });
    for (const editor of await $$('[data-pane-kind="editor"] .cm-content')) {
      await browser.execute((element: HTMLElement) => { element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); element.focus(); }, editor);
      await browser.waitUntil(async () => {
        const state = await browser.execute(() => (window as EditorHost).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState());
        return state.noteId === note.noteId && Boolean(state.editor?.markdown.includes('An unchanged note')) && !state.workspaceOperationPending;
      });
    }
    const intent: PublicationIntent = { effect: 'rename', authorityId: authority.authorityId, intentId: prepared.intentId, target: prepared.target };
    const taskId = await browser.execute((conversationId: number, intent: PublicationIntent) => new Promise<number>((resolve, reject) => {
      void (async () => {
        const bridge = (window as EditorHost).__GNEAUXGHTS_NATIVE_E2E__!;
        const runtime = await bridge.piChat(), context = await bridge.piContext();
        const conversation = await runtime.harness.conversation(conversationId as ConversationId, context);
        if (!conversation) throw new Error('Original conversation missing');
        const task = await bridge.piPublicationTask();
        return conversation.commit(tx => tx.createTask(task, intent, { ownership: { kind: 'conversation' } }), context);
      })().then(resolve, reject);
    }), selected.conversationId, intent);
    let outcome: { status: string; result?: PublicationTaskResult } | undefined;
    await browser.waitUntil(async () => {
      const task = await browser.execute((id: number) => new Promise<unknown>((resolve, reject) => {
        void (async () => { const bridge = (window as EditorHost).__GNEAUXGHTS_NATIVE_E2E__!; const runtime = await bridge.piChat(), context = await bridge.piContext(); return runtime.harness.getTask(id as TaskId, context); })().then(resolve, reject);
      }), taskId) as { state: { status: string; outcome?: typeof outcome } } | undefined;
      outcome = task?.state.outcome;
      return task?.state.status === 'terminal';
    }, { timeout: 30_000 });
    assert.equal(outcome?.status, 'completed'); assert.equal(outcome?.result?.status, 'committed', JSON.stringify(outcome));
    const titles = await $$('[data-pane-kind="editor"] [data-testid="note-title"]');
    for (const title of titles) assert.equal(await title.getValue(), 'Pi two-pane filename destination');
    const editors = await $$('[data-pane-kind="editor"] .cm-content');
    for (const editor of editors) {
      await browser.execute((element: HTMLElement) => { element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); element.focus(); }, editor);
      const state = await browser.execute(() => (window as EditorHost).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState());
      assert.equal(state.noteId, note.noteId); assert(state.editor?.markdown.includes('An unchanged note'));
    }
    const destination = join(dirname(note.path), 'Pi two-pane filename destination.md');
    assert.equal(readFileSync(destination, 'utf8'), note.raw); assert.equal(existsSync(note.path), false);
    // The background WebView cannot establish actual OS typing. Continue with
    // a public CodeMirror transaction through the mounted shared editor owner,
    // then await ordinary canonical persistence at the adopted filename.
    await browser.waitUntil(async () => browser.execute(() => {
      const editors = [...document.querySelectorAll<HTMLElement>('[data-pane-kind="editor"] .cm-content')];
      return editors.length === 2 && editors.every(editor => editor.isContentEditable && !editor.closest('[inert]'));
    }));
    const [continuedEditor] = await $$('[data-pane-kind="editor"] .cm-content');
    await browser.execute((element: HTMLElement) => new Promise<void>((resolve, reject) => {
      void (async () => {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); element.focus();
        const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
          .find(url => /\/@codemirror_view\.js(?:\?|$)/.test(url));
        if (!moduleUrl) throw new Error('App-resolved CodeMirror view module missing');
        const { EditorView } = await import(/* @vite-ignore */ moduleUrl) as typeof import('@codemirror/view');
        const view = EditorView.findFromDOM(element);
        if (!view) throw new Error('Current mounted editor view missing');
        view.dispatch({ changes: { from: view.state.doc.length, insert: '\nContinued after rename.' }, userEvent: 'input.type' });
      })().then(resolve, reject);
    }), continuedEditor);
    await browser.waitUntil(async () => (await browser.execute(() => (window as EditorHost).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState())).editor?.markdown.includes('Continued after rename.') === true);
    await browser.waitUntil(() => readFileSync(destination, 'utf8').includes('Continued after rename.'), { timeout: 30_000 });
    for (const editor of editors) assert((await editor.getText()).includes('Continued after rename.'));
    assert.equal(existsSync(note.path), false);
  });
});

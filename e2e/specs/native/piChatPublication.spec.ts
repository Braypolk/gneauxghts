import assert from 'node:assert/strict';
import { $, browser } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { invokeNative } from '../../support/liveNative';
import { navigateAppTab } from '../../support/appNavigation';
import type { AuthoritySnapshot, WritePolicy } from '../../../src/lib/features/chat/pi/authority';
import type { PreparedMutation, PublicationResult, Mutation } from '../../../src/lib/features/chat/pi/publication';
import type { HistoryModePage, HistoricalRevision } from '../../../src/lib/features/history/historyModeMachine';
import type { ParkedPublicationReceipt, PiNativeInvokeStats } from '../../../src/lib/e2e/piNativeInvokeProbe';
import { activatePiEditor, configurePi, newPiConversation, observePi, openPiPane, paneState, piDiagnostics, publishPiIntent, restartPiFixture, savePiFixtureNote, sendPiMessage, startPiProviderFixture, waitPiIdle, writePiReport } from '../../support/piChatAcceptance';

type RemountHost = Window & {
  __GNEAUXGHTS_NATIVE_E2E__?: {
    piNativeInvokeProbe(): Promise<typeof import('../../../src/lib/e2e/piNativeInvokeProbe')>;
    readEditorState(): { noteId: string | null; editor: { markdown: string } | null };
  };
  __PI_CHAT_ACCEPTANCE__?: { native: { read(): PiNativeInvokeStats } };
  __PI_PUBLICATION_REMOUNT__?: {
    predecessor: NonNullable<RemountHost['__GNEAUXGHTS_NATIVE_E2E__']>;
    receipt?: ParkedPublicationReceipt;
    held: boolean;
    prematureEditorMounts: number;
    watchEditors(): void;
    release(): void;
    stop(): void;
  };
};

describe('synthetic actual Pi publication tasks through the real document owner', function () {
  this.timeout(240_000);
  let provider: Awaited<ReturnType<typeof startPiProviderFixture>>;
  const evidence: unknown[] = [];
  before(async () => { provider = await startPiProviderFixture(); await configurePi(provider.endpoint, provider.model); await openPiPane(); await observePi(); });
  after(async () => { try { await writePiReport('pi-publication', { kind: 'real-native-mutation-synthetic-Pi-task', evidence, diagnostics: await piDiagnostics() }); } finally { await provider?.close(); } });
  const authority = async () => {
    const reference = (await paneState()).authority!;
    return invokeNative<AuthoritySnapshot>('pi_chat_authority', { authorityId: reference.authorityId });
  };
  const policy = async (reviewBeforeApplying: boolean, off = false) => {
    const current = await authority();
    const write: WritePolicy = { grant: off ? { duration: 'off' } : { duration: 'temporary', conversationId: (await paneState()).conversationId!, operations: ['update'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying };
    return invokeNative<AuthoritySnapshot>('pi_chat_set_write_policy', { authorityId: current.authorityId, expectedRevision: current.revision, write });
  };
  const prepare = async (mutation: Mutation) => invokeNative<PreparedMutation>('pi_chat_prepare_mutation', { authorityId: (await authority()).authorityId, requestId: `acceptance-${crypto.randomUUID()}`, mutation });
  const update = async (title: string, markdown: string): Promise<Mutation> => {
    const note = await savePiFixtureNote(title, 'Original synthetic update base.');
    const read = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: (await authority()).authorityId, noteId: note.noteId });
    return { operation: 'update', noteId: note.noteId, expectedReadSourceId: read.source.sourceId, markdown };
  };
  const run = async (prepared: PreparedMutation) => {
    const settled = await publishPiIntent({ authorityId: (await authority()).authorityId, intentId: prepared.intentId, target: prepared.target });
    evidence.push(settled);
    assert.equal(settled.state.outcome.status, 'completed', JSON.stringify(settled.state.outcome));
    assert(settled.state.outcome.result);
    return settled.state.outcome.result;
  };
  beforeEach(async () => { await newPiConversation(); await sendPiMessage('synthetic publication setup'); await waitPiIdle(); });

  it('defaults to review, publishes only the exact approval and replays its native receipt', async () => {
    const original = await authority(); assert.equal(original.write.reviewBeforeApplying, true); assert.equal(original.write.grant.duration, 'off');
    await policy(true);
    const prepared = await prepare(await update('Pi approved synthetic update', 'Approved synthetic update body.'));
    assert.equal(prepared.reviewRequired, true);
    const blocked = await run(prepared); assert.equal(blocked.status, 'blocked');
    if (blocked.status === 'blocked') assert.equal(blocked.code, 'review_required');
    assert(readFileSync(prepared.target.path, 'utf8').includes('Original synthetic update base.'));
    await invokeNative('pi_chat_approve_mutation', { authorityId: original.authorityId, intentId: prepared.intentId, payloadHash: prepared.payloadHash });
    const committed = await run(prepared); assert.equal(committed.status, 'committed');
    assert(readFileSync(prepared.target.path, 'utf8').includes('Approved synthetic update body.'));
    // Ignore the completed task result, then reacquire native proof and replay.
    // This proves receipt recovery; process interruption/lost transport ack is a separate native fault test.
    const recovered = await invokeNative<PublicationResult>('pi_chat_reconcile_mutation', { intentId: prepared.intentId });
    assert.equal(recovered.status, 'committed');
    assert(committed.status === 'committed' && recovered.status === 'committed');
    assert.equal(recovered.receiptId, committed.receiptId);
    assert.equal(recovered.markdown, 'Approved synthetic update body.');
    assert.deepEqual(Object.keys(committed).sort(), ['noteId', 'receiptId', 'status'], 'Pi task results must expose only the opaque committed identity');
    assert.deepEqual(await run(prepared), committed);
  });

  it('honors explicit direct authority and blocks changed canonical bases', async () => {
    await policy(false);
    const direct = await run(await prepare(await update('Pi direct synthetic update', 'Direct synthetic update body.')));
    assert.equal(direct.status, 'committed');
    const note = await savePiFixtureNote('Pi stale synthetic update', 'Original update base.');
    const read = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: (await authority()).authorityId, noteId: note.noteId });
    const stale = await prepare({ operation: 'update', noteId: note.noteId, expectedReadSourceId: read.source.sourceId, markdown: 'Agent must not replace newer canonical bytes.' });
    await savePiFixtureNote(note.title, 'Newer canonical fixture bytes.', note.path);
    const denied = await run(stale); assert.equal(denied.status, 'blocked');
    if (denied.status === 'blocked') assert.equal(denied.code, 'changed_base');
    assert(readFileSync(note.path, 'utf8').includes('Newer canonical fixture bytes.'));
    const freshRead = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: (await authority()).authorityId, noteId: note.noteId });
    const updated = await run(await prepare({ operation: 'update', noteId: note.noteId, expectedReadSourceId: freshRead.source.sourceId, markdown: 'Fresh authorized synthetic update.' }));
    assert.equal(updated.status, 'committed');
    assert(readFileSync(note.path, 'utf8').includes('Fresh authorized synthetic update.'));
  });

  it('blocks an admitted but unpublished mutation after grant revocation', async () => {
    await policy(false);
    const prepared = await prepare(await update('Pi revoked update', 'Revoked mutation must not publish.'));
    await policy(false, true);
    const result = await run(prepared); assert.equal(result.status, 'blocked');
    assert(readFileSync(prepared.target.path, 'utf8').includes('Original synthetic update base.'));
  });
  (process.env.GNEAUX_PI_PROCESS_RESTART === '1' ? it : it.skip)('retains Temporary authority in the same reopened chat and never inherits it in a new chat', async () => {
    await policy(false);
    const original = await authority(), conversationId = (await paneState()).conversationId;
    await $('[aria-label="Conversation title"]').setValue('Pi temporary grant reopen proof');
    await $('textarea[aria-label="Message"]').click();
    await browser.waitUntil(async () => (await paneState()).title === 'Pi temporary grant reopen proof');
    const prepared = await prepare(await update('Pi temporary reopened update', 'Temporary authority survives only its original conversation.'));
    const restart = await restartPiFixture();
    if ((await paneState()).conversationId !== conversationId) {
      await $('[aria-label="Conversations"]').click(); await $('button[role="menuitem"]*=Pi temporary grant reopen proof').click();
    }
    await browser.waitUntil(async () => (await paneState()).conversationId === conversationId);
    const reopened = await authority(); assert.deepEqual(reopened.write, original.write); assert.equal(reopened.authorityId, original.authorityId);
    const committed = await run(prepared); assert.equal(committed.status, 'committed');
    await newPiConversation(); await sendPiMessage('Fresh chat receives no previous Temporary grant.'); await waitPiIdle();
    const fresh = await authority(); assert.equal(fresh.write.grant.duration, 'off');
    await assert.rejects(prepare(await update('Pi inherited grant must fail', 'No inherited temporary authority.')));
    evidence.push({ kind: 'temporary-grant-real-process-reopen', restart, original, reopened, fresh });
  });

  it('preserves actual human editor input when a prepared update reaches the document owner', async () => {
    const note = await savePiFixtureNote('Pi dirty editor target', 'Clean canonical editor base.');
    await invokeNative('mark_note_opened', { noteId: note.noteId });
    await browser.refresh();
    await browser.waitUntil(async () => await $('[data-testid="note-title"]').getValue() === note.title, { timeout: 30_000 });
    await openPiPane(); await observePi();
    await newPiConversation(); await sendPiMessage('dirty editor publication setup'); await waitPiIdle(); await policy(false);
    const read = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: (await authority()).authorityId, noteId: note.noteId });
    const prepared = await prepare({ operation: 'update', noteId: note.noteId, expectedReadSourceId: read.source.sourceId, markdown: 'Agent replacement must never erase the human editor.' });
    await activatePiEditor();
    const human = 'Human input entered through the actual mounted editor immediately before the Pi publication task.';
    const settled = await publishPiIntent({ authorityId: (await authority()).authorityId, intentId: prepared.intentId, target: prepared.target }, human);
    evidence.push({ kind: 'actual-mounted-dirty-editor', settled });
    assert.equal(settled.editorAtTaskCreation?.editor?.markdown, human);
    const result = settled.state.outcome.result;
    assert(settled.state.outcome.status !== 'completed' || result?.status === 'blocked', 'Dirty input must prevent the prepared agent replacement');
    if (settled.state.outcome.status !== 'completed') assert.equal(settled.publicationInvokes, 0, 'Dirty document owner must reject before a native write effect');
    assert(!readFileSync(note.path, 'utf8').includes('Agent replacement'));
    const current = await browser.execute(() => (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__: { readEditorState(): { editor: { markdown: string } | null } } }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState());
    assert.equal(current.editor?.markdown, human);
  });

  it('joins a committed publication and canonical adoption before a Settings round trip remounts editors', async () => {
    const note = await savePiFixtureNote('Pi SPA publication target', 'Clean base before the Settings round trip.');
    await invokeNative('mark_note_opened', { noteId: note.noteId });
    // Fixture setup only. The regression below navigates through ordinary SPA
    // controls and keeps this WebView, Pi runtime and held acknowledgement alive.
    await browser.refresh();
    await browser.waitUntil(async () => await $('[data-testid="note-title"]').getValue() === note.title, { timeout: 30_000 });
    await openPiPane(); await observePi();
    await newPiConversation(); await sendPiMessage('SPA publication remount setup'); await waitPiIdle(); await policy(false);
    const conversationId = (await paneState()).conversationId;
    const read = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: (await authority()).authorityId, noteId: note.noteId });
    const markdown = 'Canonical publication committed while its frontend acknowledgement is held.';
    const prepared = await prepare({ operation: 'update', noteId: note.noteId, expectedReadSourceId: read.source.sourceId, markdown });
    const history = () => invokeNative<HistoryModePage>('get_note_history_page', { noteId: note.noteId, cursor: null, limit: 30 });
    const beforeHistory = await history();
    const before = await browser.execute(() => (window as RemountHost).__PI_CHAT_ACCEPTANCE__!.native.read());
    const armed = await browser.executeAsync((intentId: string, done: (error: string | null) => void) => {
      void (async () => {
        const host = window as RemountHost, predecessor = host.__GNEAUXGHTS_NATIVE_E2E__!;
        let release!: () => void;
        const acknowledgement = new Promise<void>(resolve => { release = resolve; });
        const observer = new MutationObserver(() => {
          if (state.held && document.querySelector('[data-pane-kind="editor"] .cm-content')) state.prematureEditorMounts++;
        });
        const state: NonNullable<RemountHost['__PI_PUBLICATION_REMOUNT__']> = host.__PI_PUBLICATION_REMOUNT__ = {
          predecessor, held: true, prematureEditorMounts: 0,
          watchEditors: () => observer.observe(document.body, { childList: true, subtree: true }),
          release: () => { state.held = false; release(); },
          stop: () => { observer.disconnect(); disarm(); state.release(); }
        };
        // The existing observer parks only after the actual native write returns
        // committed; no writer, document owner or native outcome is substituted.
        const disarm = (await predecessor.piNativeInvokeProbe()).parkNextPublicationAcknowledgement(intentId, async receipt => {
          state.receipt = receipt;
          await acknowledgement;
        });
      })().then(() => done(null), error => done(String(error)));
    }, prepared.intentId);
    assert.equal(armed, null);
    try {
      const settled = await publishPiIntent({ authorityId: (await authority()).authorityId, intentId: prepared.intentId, target: prepared.target }, null, async () => {
        await browser.waitUntil(async () => await browser.execute(() => Boolean((window as RemountHost).__PI_PUBLICATION_REMOUNT__?.receipt)), { timeout: 30_000, timeoutMsg: 'Real native committed acknowledgement was not parked' });
        assert(readFileSync(note.path, 'utf8').includes(markdown), 'Canonical bytes must exist before SPA departure');
        await navigateAppTab('Settings');
        await $('main[aria-label="Settings"]').waitForDisplayed();
        await browser.waitUntil(async () => await browser.execute(() => !(window as RemountHost).__GNEAUXGHTS_NATIVE_E2E__), { timeout: 30_000 });
        await browser.execute(() => (window as RemountHost).__PI_PUBLICATION_REMOUNT__!.watchEditors());
        await navigateAppTab('Gneauxght');
        await browser.waitUntil(async () => await browser.execute(() => {
          const host = window as RemountHost, state = host.__PI_PUBLICATION_REMOUNT__;
          return location.pathname === '/' && Boolean(state && host.__GNEAUXGHTS_NATIVE_E2E__ && host.__GNEAUXGHTS_NATIVE_E2E__ !== state.predecessor);
        }), { timeout: 30_000, timeoutMsg: 'Ordinary SPA return did not create a replacement workspace' });
        const waiting = await browser.execute(() => {
          const host = window as RemountHost, state = host.__PI_PUBLICATION_REMOUNT__!;
          return { held: state.held, receipt: state.receipt, prematureEditorMounts: state.prematureEditorMounts, editors: document.querySelectorAll('[data-pane-kind="editor"] .cm-content').length, native: host.__PI_CHAT_ACCEPTANCE__!.native.read() };
        });
        evidence.push({ kind: 'spa-return-waits-for-real-publication-adoption', taskIntentId: prepared.intentId, waiting });
        assert.equal(waiting.held, true);
        assert.equal(waiting.receipt?.noteId, note.noteId);
        assert.equal(waiting.native.parkedAcknowledgements, before.parkedAcknowledgements + 1);
        assert.equal(waiting.native.bridge.pi_chat_close_editor_owner?.calls ?? 0, (before.bridge.pi_chat_close_editor_owner?.calls ?? 0) + 1);
        assert.equal(waiting.native.bridge.pi_chat_bind_editor_owner?.calls ?? 0, before.bridge.pi_chat_bind_editor_owner?.calls ?? 0, 'Replacement owner must join predecessor adoption before binding');
        assert.equal(waiting.editors, 0, 'Replacement editor must not mount while predecessor canonical adoption is held');
        assert.equal(waiting.prematureEditorMounts, 0);
        await browser.execute(() => (window as RemountHost).__PI_PUBLICATION_REMOUNT__!.release());
      });
      assert.equal(settled.state.outcome.status, 'completed', JSON.stringify(settled.state.outcome));
      assert.equal(settled.state.outcome.result?.status, 'committed');
      assert.equal(settled.publicationInvokes, 1, 'SPA remount must retain the original task and one native publication');
      const receipt = await browser.execute(() => (window as RemountHost).__PI_PUBLICATION_REMOUNT__!.receipt!);
      assert.deepEqual(settled.state.outcome.result, { status: 'committed', receiptId: receipt.receiptId, noteId: receipt.noteId });
      await $('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content').waitForExist({ timeout: 30_000 });
      await activatePiEditor();
      await browser.waitUntil(async () => await browser.execute((expected: string) => (window as RemountHost).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState().editor?.markdown === expected, markdown), { timeout: 30_000, timeoutMsg: 'Replacement editor did not adopt the committed canonical body' });
      const adopted = await browser.execute(() => (window as RemountHost).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState());
      assert.equal(adopted.noteId, note.noteId);
      const afterHistory = await history();
      const newRevisions = afterHistory.records.filter(row => row.kind === 'revision' && !beforeHistory.records.some(before => before.recordId === row.recordId));
      assert.equal(newRevisions.length, 1, 'One committed update must produce exactly one canonical revision');
      const revision = newRevisions[0];
      assert(revision.kind === 'revision');
      assert.equal((await invokeNative<HistoricalRevision>('get_note_history_revision', { noteId: note.noteId, revisionId: revision.revisionId })).body, markdown);
      await openPiPane();
      await browser.waitUntil(async () => (await paneState()).conversationId === conversationId, { timeout: 30_000 });
      assert.equal((await paneState()).error, null);
      const replay = await publishPiIntent({ authorityId: (await authority()).authorityId, intentId: prepared.intentId, target: prepared.target });
      assert.deepEqual(replay.state.outcome.result, settled.state.outcome.result);
      assert.equal(replay.publicationInvokes, 0, 'Receipt replay must not invoke a second native publication');
      assert.deepEqual((await history()).records.map(row => row.recordId), afterHistory.records.map(row => row.recordId));
      const freshRead = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: (await authority()).authorityId, noteId: note.noteId });
      const secondMarkdown = 'A second real publication succeeds through the replacement workspace owner.';
      const second = await prepare({ operation: 'update', noteId: note.noteId, expectedReadSourceId: freshRead.source.sourceId, markdown: secondMarkdown });
      const secondSettled = await publishPiIntent({ authorityId: (await authority()).authorityId, intentId: second.intentId, target: second.target });
      assert.equal(secondSettled.state.outcome.status, 'completed', JSON.stringify(secondSettled.state.outcome));
      assert.equal(secondSettled.state.outcome.result?.status, 'committed');
      assert.equal(secondSettled.publicationInvokes, 1);
      assert(readFileSync(note.path, 'utf8').includes(secondMarkdown));
      await activatePiEditor();
      const secondAdopted = await browser.execute(() => (window as RemountHost).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState());
      assert.equal(secondAdopted.noteId, note.noteId);
      assert.equal(secondAdopted.editor?.markdown, secondMarkdown);
      evidence.push({ kind: 'spa-publication-remount-settled', settled, receipt, adopted, revision, replay, secondSettled, secondAdopted });
    } finally {
      await browser.execute(() => {
        const host = window as RemountHost;
        host.__PI_PUBLICATION_REMOUNT__?.stop();
        delete host.__PI_PUBLICATION_REMOUNT__;
      });
    }
  });

});

import assert from 'node:assert/strict';
import { $, browser } from '@wdio/globals';
import { invokeNative } from '../../support/liveNative';
import { navigateAppTab } from '../../support/appNavigation';
import { assistantText, configurePi, live, messages, newPiConversation, observePi, openPiPane, paneState, piDiagnostics, restartPiFixture, savePiFixtureNote, sendPiMessage, startPiProviderFixture, waitPiIdle, writePiReport } from '../../support/piChatAcceptance';

describe('ordinary Pi native integration with deterministic provider faults', function () {
  this.timeout(240_000);
  let provider: Awaited<ReturnType<typeof startPiProviderFixture>>;
  let lantern: Awaited<ReturnType<typeof savePiFixtureNote>>;
  let originalProcessDiagnostics: Awaited<ReturnType<typeof piDiagnostics>> | undefined;
  const selectReadMode = async (mode: 'fullVault' | 'attachedNotesOnly') => {
    const label = mode === 'fullVault' ? 'Full vault' : 'No notes';
    const access = await $('button[aria-label="Vault access"]'); await access.waitForEnabled(); await access.click();
    await $(`[role="menuitemradio"]=${label}`).click();
    await browser.waitUntil(async () => {
      const pane = await paneState() as Awaited<ReturnType<typeof paneState>> & { read: { mode: string } };
      return pane.read.mode === mode && (await access.$('.chat-composer-access-label').getText()).trim() === label;
    }, { timeoutMsg: 'Mounted access control did not update the actual Pi pane read policy' });
  };
  before(async () => { provider = await startPiProviderFixture(); await configurePi(provider.endpoint, provider.model); await openPiPane(); await observePi(); lantern = await savePiFixtureNote('Pi acceptance lantern', 'The lantern is amber.'); });
  after(async () => {
    try {
      const diagnostics = await piDiagnostics();
      await writePiReport('pi-native-fixture', { kind: 'deterministic-http-provider-native-integration', requests: provider?.requests, diagnostics,
        observerScope: 'Each native process installs a fresh observer; process observations are not cumulative across restart.',
        processObservations: [...(originalProcessDiagnostics ? [{ phase: 'original-process', diagnostics: originalProcessDiagnostics }] : []), { phase: originalProcessDiagnostics ? 'restarted-process' : 'original-process', diagnostics }] });
    }
    finally { await provider?.close(); }
  });

  it('streams text/reasoning, persists native read receipts and admits only terminal citations', async () => {
    const id = await sendPiMessage('fixture-read');
    const pane = await waitPiIdle();
    assert(assistantText(pane).includes('The lantern is amber.'));
    const read = messages(pane).find(message => message.role === 'toolResult' && message.toolName === 'read_note');
    assert(read?.role === 'toolResult' && !read.isError);
    assert(read.details && typeof read.details === 'object' && 'source' in read.details, 'Native read identity must survive in Pi tool details');
    const result = JSON.parse(read.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    assert.equal(result.source.readState, undefined, 'Native proof does not belong in model tool content');
    const source = read.details.source as { readState: { contentHash: string } };
    assert(source.readState.contentHash, 'Native proof remains available to the app');
    assert(await $('[data-pi-source]').isExisting());
    const diagnostics = (await piDiagnostics()).progress;
    const observed = diagnostics.conversations[id];
    assert(observed.textWhileBusy && observed.reasoningWhileBusy);
    assert(observed.uiTextWhileBusy && observed.uiReasoningWhileBusy);
    assert(diagnostics.bridge.pi_chat_fetch?.calls > 0 && diagnostics.bridge.pi_chat_fetch.requestBytes > 0, 'The test-build observer must measure actual Pi native transport calls');
    assert(diagnostics.transport.frames > 0 && diagnostics.transport.providerBytes > 0, 'The observer must measure actual native provider Channel delivery');
    const count = provider.requests;
    // Wait for actual rename and conversation-list state, independent of frame
    // scheduling in a background WebView.
    await $('[aria-label="Conversation title"]').setValue('Pi idle title/list observation');
    await $('textarea[aria-label="Message"]').click();
    await browser.waitUntil(async () => (await paneState()).title === 'Pi idle title/list observation');
    await $('button[aria-label="Conversations"]').click();
    await $('button[role="menuitem"]*=Pi idle title/list observation').waitForExist();
    await $('button[aria-label="Conversations"]').click();
    assert.equal(provider.requests, count, 'Idle title/list updates must not trigger inference');
  });

  it('keeps observing the current workspace across Settings navigation', async () => {
    await browser.execute(() => {
      const host = window as Window & {
        __GNEAUXGHTS_NATIVE_E2E__?: { readPiChatState(): unknown };
        __PI_OBSERVER_LIFETIME__?: { retiredReads: number; errors: string[]; cleanup(): void };
      };
      const bridge = host.__GNEAUXGHTS_NATIVE_E2E__!;
      const read = bridge.readPiChatState;
      const errors: string[] = [];
      const onError = (event: ErrorEvent) => { errors.push(event.message); };
      const evidence = { retiredReads: 0, errors, cleanup() {
        window.removeEventListener('error', onError); bridge.readPiChatState = read;
        delete host.__PI_OBSERVER_LIFETIME__;
      } };
      bridge.readPiChatState = () => {
        if (host.__GNEAUXGHTS_NATIVE_E2E__ !== bridge) evidence.retiredReads++;
        return read();
      };
      window.addEventListener('error', onError);
      host.__PI_OBSERVER_LIFETIME__ = evidence;
    });
    const evidence = () => browser.execute(() => {
      const value = (window as Window & { __PI_OBSERVER_LIFETIME__?: { retiredReads: number; errors: string[] } }).__PI_OBSERVER_LIFETIME__!;
      return { retiredReads: value.retiredReads, errors: value.errors };
    });
    try {
      const requests = provider.requests;
      await navigateAppTab('Settings');
      await $('[data-testid="note-editor"]').waitForExist({ reverse: true });
      // Deliver a DOM mutation after the real workspace has unmounted.
      await browser.execute(async () => {
        const marker = document.createElement('span'); document.body.append(marker); marker.remove();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      assert.equal((await evidence()).retiredReads, 0, 'Observer read a destroyed workspace after Settings navigation');
      await navigateAppTab('Gneauxght');
      await $('[data-testid="note-editor"]').waitForExist(); await openPiPane();
      assert.equal(provider.requests, requests, 'Navigation must not start inference');
      await newPiConversation(); const id = await sendPiMessage('fixture-read observer navigation'); await waitPiIdle();
      const progress = (await piDiagnostics()).progress;
      assert.equal(progress.observerErrors, 0);
      const observed = progress.conversations[id];
      assert(observed?.textWhileBusy && observed.reasoningWhileBusy, 'Observer must follow the new workspace conversation');
      assert(observed.uiTextWhileBusy && observed.uiReasoningWhileBusy, 'Observer must retain real DOM delivery evidence');
      const final = await evidence(); assert.equal(final.retiredReads, 0);
      assert(!final.errors.some(message => message.includes('Unknown workspace pane')), 'Navigation emitted a stale workspace observer error');
    } finally {
      try {
        if (await browser.execute(() => location.pathname) !== '/') {
          await navigateAppTab('Gneauxght'); await $('[data-testid="note-editor"]').waitForExist();
        }
      } finally {
        await browser.execute(() => (window as Window & { __PI_OBSERVER_LIFETIME__?: { cleanup(): void } }).__PI_OBSERVER_LIFETIME__?.cleanup());
      }
    }
  });

  it('parses a valid SSE stream with a missing Content-Type header through Pi', async () => {
    await newPiConversation();
    await sendPiMessage('fixture-missing-content-type');
    const pane = await waitPiIdle();
    assert.equal(messages(pane).filter(message => message.role === 'assistant').at(-1)?.stopReason, 'stop');
    assert(assistantText(pane).includes('Fixture ordinary answer. Finished.'));
    assert.equal(pane.error, null);
  });

  it('retrieves ordinary query search through the native current-content boundary', async () => {
    const response = await invokeNative<{ status: string; items: { noteId: string; excerpt: string; documentKind: string }[] }>('retrieve_note_context', {
      scope: 'query', query: 'lantern', currentPath: null, currentTitle: '', currentMarkdown: null, currentBodyHash: null, selectedText: null, limit: 20,
    });
    assert.equal(response.status, 'ready');
    const note = response.items.find(item => item.noteId === lantern.noteId);
    assert(note && note.excerpt.includes('lantern'), 'Ordinary query IPC must retain the canonical saved note preview');
    assert(response.items.every(item => item.documentKind === 'note'));
  });

  it('keeps actual native tool errors visible as tool outcomes', async () => {
    await newPiConversation(); await sendPiMessage('fixture-error');
    const pane = await waitPiIdle();
    assert(messages(pane).some(message => message.role === 'toolResult' && message.toolName === 'read_note' && message.isError));
    assert(await $('[data-testid="pi-tool-result"][data-error="true"]').isExisting());
  });

  it('withdraws queued input, stops work including background tasks, and keeps independent chat history', async () => {
    await newPiConversation(); const id = await sendPiMessage('fixture-hold');
    await browser.waitUntil(async () => Boolean(live(await paneState())?.run));
    await sendPiMessage('Withdraw this exact queued fixture message');
    await $('[data-testid="pi-queue"]').waitForExist();
    await $('[aria-label="Withdraw queued message"]').click();
    await browser.waitUntil(async () => !await $('[data-testid="pi-queue"]').isExisting());
    await browser.waitUntil(async () => Boolean(await $('[data-testid="pi-assistant-message"][data-streaming="true"] .gn-markdown-surface').getText()));
    await $('[data-testid="pi-stop"]').click();
    const stopped = await waitPiIdle();
    assert(!messages(stopped).some(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes('Withdraw this exact')));
    assert(messages(stopped).some(message => message.role === 'assistant' && message.stopReason === 'aborted'));
    await newPiConversation(); await sendPiMessage('second independent fixture conversation'); await waitPiIdle();
    await $('button[aria-label="Conversations"]').click();
    await $('button[role="menuitem"]*=fixture-hold').click();
    await browser.waitUntil(async () => (await paneState()).conversationId === id);
    assert(assistantText(await paneState()).includes('Fixture ordinary answer.'));
  });

  it('restores each mounted conversation composer draft without inference', async () => {
    await newPiConversation(); const firstId = await sendPiMessage('first composer fixture'); await waitPiIdle();
    await $('textarea[aria-label="Message"]').setValue('Unsent first conversation draft');
    await newPiConversation(); await sendPiMessage('second composer fixture'); await waitPiIdle();
    await $('textarea[aria-label="Message"]').setValue('Unsent second conversation draft');
    const count = provider.requests;
    await $('button[aria-label="Conversations"]').click(); await $('button[role="menuitem"]*=first composer fixture').click();
    await browser.waitUntil(async () => (await paneState()).conversationId === firstId);
    await browser.waitUntil(async () => await $('textarea[aria-label="Message"]').getValue() === 'Unsent first conversation draft');
    assert.equal(provider.requests, count, 'Composer switching must not trigger inference');
  });

  it('retains terminal failure and makes New attempt a fresh user submission', async () => {
    await newPiConversation(); provider.setFailure(true);
    await sendPiMessage('fixture-recover'); const failed = await waitPiIdle();
    assert(messages(failed).some(message => message.role === 'assistant' && message.stopReason === 'error'));
    await $('[data-testid="pi-new-attempt"]').waitForExist();
    const before = messages(failed).filter(message => message.role === 'user').length;
    provider.setFailure(false); await $('[data-testid="pi-new-attempt"]').click();
    await browser.waitUntil(async () => messages(await paneState()).filter(message => message.role === 'user').length > before);
    const recovered = await waitPiIdle();
    assert.equal(messages(recovered).filter(message => message.role === 'assistant').at(-1)?.stopReason, 'stop');
    assert(messages(recovered).some(message => message.role === 'assistant' && message.stopReason === 'error'));
  });

  it('preserves an honestly historical read after canonical content changes', async () => {
    await newPiConversation();
    await selectReadMode('fullVault');
    await sendPiMessage('fixture-read full-vault note reference');
    const pane = await waitPiIdle();
    assert.equal(pane.authority?.read.mode, 'fullVault');
    const tool = messages(pane).find(message => message.role === 'toolResult' && message.toolName === 'read_note');
    assert(tool?.role === 'toolResult');
    const payload = JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { source: { sourceId: string; readState: { kind: string } } };
    await savePiFixtureNote(lantern.title, 'The lantern is violet after the recorded read.', lantern.path);
    const destination = await invokeNative<{ kind: string }>('pi_chat_open_source', { authorityId: pane.authority!.authorityId, sourceId: payload.source.sourceId });
    assert.equal(destination.kind, 'note');
    assert(assistantText(pane).includes('amber'), 'Historical answer must retain its original claim');
    await writePiReport('pi-historical-source', { readState: payload.source.readState, destination, oldAnswer: assistantText(pane) });
  });

  it('denies note reads in No notes mode without an attachment picker', async () => {
    await newPiConversation(); await selectReadMode('attachedNotesOnly');
    await sendPiMessage('No notes access fixture.'); await waitPiIdle();
    const pane = await paneState();
    assert.deepEqual(pane.authority?.read, { mode: 'attachedNotesOnly', attachedNoteIds: [] });
    assert.equal(await $('[aria-label="Attach notes"]').isExisting(), false);
    await assert.rejects(invokeNative('pi_chat_read_note', { authorityId: pane.authority!.authorityId, noteId: lantern.noteId }));
    await selectReadMode('fullVault');
  });

  it('keeps a running chat independent while another conversation is selected', async () => {
    await newPiConversation(); const runningId = await sendPiMessage('fixture-hold independent background chat');
    await browser.waitUntil(async () => Boolean(live(await paneState())?.run));
    await newPiConversation(); const secondId = await sendPiMessage('foreground independent fixture answer');
    await waitPiIdle(); assert.notEqual(secondId, runningId);
    assert.equal((await paneState()).conversationId, secondId);
    await $('button[aria-label="Conversations"]').click();
    await $('button[role="menuitem"]*=fixture-hold independent background chat').click();
    await browser.waitUntil(async () => (await paneState()).conversationId === runningId);
    await waitPiIdle();
    assert.equal(messages(await paneState()).filter(message => message.role === 'assistant').at(-1)?.stopReason, 'stop');
  });

  it('retires in-flight authority on exclusion and denies old source navigation', async () => {
    const note = await savePiFixtureNote('Pi exclusion sentinel', 'Synthetic excluded content.');
    await newPiConversation(); const oldId = await sendPiMessage('fixture-hold exclusion retirement');
    await browser.waitUntil(async () => Boolean(live(await paneState())?.run));
    const oldAuthority = (await paneState()).authority!;
    const read = await invokeNative<{ source: { sourceId: string } }>('pi_chat_read_note', { authorityId: oldAuthority.authorityId, noteId: note.noteId });
    await invokeNative('pi_chat_set_exclusion', { noteId: note.noteId, excluded: true });
    await browser.waitUntil(async () => { const pane = await paneState(); return Boolean(pane.conversationId && pane.conversationId !== oldId); });
    const fresh = await paneState(); assert.equal(fresh.entries.length, 0);
    await assert.rejects(invokeNative('pi_chat_open_source', { authorityId: oldAuthority.authorityId, sourceId: read.source.sourceId }));
    await assert.rejects(invokeNative('pi_chat_read_note', { authorityId: fresh.authority!.authorityId, noteId: note.noteId }));
    await invokeNative('pi_chat_set_exclusion', { noteId: note.noteId, excluded: false });
  });

  it('retires a running full-vault context when read access narrows', async () => {
    await newPiConversation(); const oldId = await sendPiMessage('fixture-hold');
    await browser.waitUntil(async () => Boolean(live(await paneState())?.run));
    const oldAuthority = (await paneState()).authority!;
    await selectReadMode('attachedNotesOnly');
    try { await browser.waitUntil(async () => { const pane = await paneState(); return Boolean(pane.conversationId && pane.conversationId !== oldId); }); }
    catch (error) {
      await writePiReport('pi-narrowing-failure', { oldId, selectedValue: await $('button[aria-label="Vault access"]').getText(), pane: await paneState(), diagnostics: await piDiagnostics() });
      throw error;
    }
    const retired = await invokeNative<{ retired: boolean }>('pi_chat_authority', { authorityId: oldAuthority.authorityId });
    assert.equal(retired.retired, true);
    const fresh = await paneState(); assert.equal(fresh.entries.length, 0, 'Restricted context must start without old model history');
    assert.notEqual(fresh.authority?.authorityId, oldAuthority.authorityId);
  });
  (process.env.GNEAUX_PI_PROCESS_RESTART === '1' ? it : it.skip)('reopens the persisted chat and composer in a different native process', async () => {
    await newPiConversation(); const id = await sendPiMessage('fixture restart persisted conversation'); await waitPiIdle();
    await $('textarea[aria-label="Message"]').setValue('Persistent unsent Pi restart draft');
    await browser.waitUntil(async () => await invokeNative<string>('chat_get_composer_draft', { slot: `pi-conversation:${id}` }) === 'Persistent unsent Pi restart draft');
    const requests = provider.requests;
    const restart = await restartPiFixture(); assert.notEqual(restart.beforePid, restart.afterPid);
    originalProcessDiagnostics = restart.beforeDiagnostics;
    if ((await paneState()).conversationId !== id) {
      await $('button[aria-label="Conversations"]').click(); await $('button[role="menuitem"]*=fixture restart persisted conversation').click();
    }
    await browser.waitUntil(async () => (await paneState()).conversationId === id);
    await browser.waitUntil(async () => await $('textarea[aria-label="Message"]').getValue() === 'Persistent unsent Pi restart draft');
    assert(assistantText(await paneState()).includes('Fixture ordinary answer.'));
    assert.equal(provider.requests, requests, 'Opening durable chat history must not trigger new inference');
    await writePiReport('pi-process-restart', { ...restart, conversationId: id, afterDiagnostics: await piDiagnostics() });
  });

});

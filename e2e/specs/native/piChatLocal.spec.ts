import assert from 'node:assert/strict';
import { $, browser } from '@wdio/globals';
import { LOCAL_PI_ENDPOINT, LOCAL_PI_MODEL, assistantText, configurePi, messages, newPiConversation, observePi, openPiPane, paneState, piDiagnostics, savePiFixtureNote, sendPiMessage, waitPiIdle, writePiReport } from '../../support/piChatAcceptance';

const accepted = process.env.GNEAUX_PI_LOCAL_ACCEPTANCE === '1' ? describe : describe.skip;
accepted('ordinary Pi chat with the actual local model', function () {
  this.timeout(660_000);
  before(async () => { await configurePi(); await openPiPane(); await observePi(); });
  after(async () => { await writePiReport('pi-local-model', { kind: 'live-local-model', endpoint: LOCAL_PI_ENDPOINT, model: LOCAL_PI_MODEL, diagnostics: await piDiagnostics() }); });

  it('delivers real source-free text and reasoning before terminal completion', async () => {
    const id = await sendPiMessage('Reason through how to organize a three-day fictional observatory visit. Then give a detailed 400-word answer. Use no notes or tools; this is an invented planning example.');
    const pane = await waitPiIdle(300_000);
    const last = messages(pane).filter(message => message.role === 'assistant').at(-1)!;
    assert.equal(last.stopReason, 'stop', last.errorMessage);
    assert(assistantText(pane).length > 0);
    const observed = (await piDiagnostics()).progress.conversations[id];
    assert(observed.textWhileBusy && observed.uiTextWhileBusy, 'Live text must be observed in Pi progress and the rendered UI before terminal completion');
    assert(observed.reasoningWhileBusy && observed.uiReasoningWhileBusy, 'Configured local reasoning must be observed in Pi progress and the rendered UI before terminal completion');
    assert(!await $('[data-testid="pi-tool-result"]').isExisting(), 'Source-free request unexpectedly invoked a note tool');
    assert(!await $('button[aria-label="Retry"]').isExisting());
    await writePiReport('pi-local-source-free', { id, answer: assistantText(pane), observed });
  });

  it('performs native search/read, admits a source and opens its destination', async () => {
    const note = await savePiFixtureNote('Pi acceptance lantern', 'The expedition lantern is amber. Its inventory code is LANTERN-742.');
    await newPiConversation();
    const id = await sendPiMessage('Find the saved note titled Pi acceptance lantern using search_notes, read its full content with read_note, and tell me the lantern color and inventory code. Cite the exact citation token returned by read_note.');
    const pane = await waitPiIdle(300_000);
    const tools = messages(pane).filter(message => message.role === 'toolResult');
    assert(tools.some(message => message.toolName === 'search_notes' && !message.isError));
    const read = tools.find(message => message.toolName === 'read_note' && !message.isError);
    assert(read, 'Actual model must execute the native read tool');
    assert(assistantText(pane).includes('LANTERN-742'));
    const source = await $('[data-pi-source]'); await source.waitForExist();
    await source.click();
    await browser.waitUntil(async () => browser.execute((id: string) => {
      const state = (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__: { readEditorState(): { noteId: string | null } } }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState();
      return state.noteId === id && !document.querySelector('[data-testid="history-mode"]');
    }, note.noteId), { timeout: 30_000, timeoutMsg: 'Native admitted citation did not navigate' });
    await writePiReport('pi-local-read', { id, noteId: note.noteId, answer: assistantText(pane), tools });
  });
});

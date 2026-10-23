import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { $, browser, expect } from '@wdio/globals';
import { invokeNative } from '../../support/liveNative';
import { activatePiEditor, assistantText, configurePi, live, messages, newPiConversation, openPiPane, paneState, sendPiMessage, startPiProviderFixture, waitPiIdle } from '../../support/piChatAcceptance';

// Real reqwest/IPC integration. This fixture never contacts a model or account.
describe('curated native provider connection failures', function () {
  this.timeout(120_000);
  let endpoint: string;
  let mode: 'empty' | 'success' | 'invalid' | 'slow' | 'memory' | 'load' | number = 'empty';
  let requests = 0;
  const navigate = async (label: 'Settings' | 'Gneauxght') => {
    const link = () => $(`a[aria-label="${label}"]`);
    if (!await link().isExisting()) await $('button[aria-label="Switch tab"]').click();
    await link().click();
  };
  const server = createServer((request, response) => {
    requests++;
    if (request.method === 'POST' && (mode === 'memory' || mode === 'load')) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: mode === 'memory' ? 'Failed to load model: insufficient memory SECRET_MODEL_PATH' : 'Unable to load model SECRET_MODEL_PATH' }));
      return;
    }
    if (mode === 'slow') return; // Production five-second discovery deadline.
    response.setHeader('content-type', 'application/json');
    if (typeof mode === 'number') response.writeHead(mode, 'SECRET_REASON');
    response.end(mode === 'invalid' ? 'SECRET_MALFORMED_BODY' : JSON.stringify(
      typeof mode === 'number' ? { error: 'SECRET_PROVIDER_BODY' } : { data: mode === 'success' ? [{ id: 'native-recovered-model' }] : [] }
    ));
  });
  before(async () => {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); assert(address && typeof address !== 'string');
    endpoint = `http://127.0.0.1:${address.port}/SECRET_ENDPOINT/v1`;
    await configurePi(endpoint, 'saved-connection-model');
  });
  after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

  it('keeps HTTP status, invalid catalogs and transport failures distinct without exposing server text', async () => {
    // Avoid the embedded driver's reserved `error` result field: provider failures
    // are successful script evaluations carrying a tagged IPC outcome.
    const listModels = () => browser.execute(async (baseUrl: string) => {
      try {
        const models = await window.__TAURI_INTERNALS__!.invoke('chat_list_local_models', { baseUrl });
        return { outcome: 'fulfilled', models };
      } catch (reason) {
        return { outcome: 'rejected', reason: String(reason) };
      }
    }, endpoint);
    for (const status of [401, 429, 503]) {
      mode = status;
      assert.deepEqual(await listModels(), {
        outcome: 'rejected', reason: `Local model server returned ${status}`
      });
    }
    mode = 'invalid';
    assert.deepEqual(await listModels(), {
      outcome: 'rejected', reason: 'Unable to read the local model catalog'
    });
    mode = 'empty';
    assert.deepEqual(await listModels(), { outcome: 'fulfilled', models: [] });
    const settings = await invokeNative<{ localModel: string }>('chat_get_settings');
    assert.equal(settings.localModel, 'saved-connection-model');
  });

  it('shows real refused/timeout failures in Settings and succeeds on a later explicit refresh', async () => {
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    const address = closed.address(); assert(address && typeof address !== 'string');
    await new Promise<void>(resolve => closed.close(() => resolve()));
    await navigate('Settings');
    await $('[data-settings-section="ai"]').click();
    const input = () => $('[data-settings-anchor="chat-endpoint"] input');
    const refresh = () => $('button[aria-label="Refresh server models"]');
    const panel = () => $('[data-settings-anchor="chat-model"]');
    await refresh().waitForDisplayed();
    const before = requests;
    await $('[data-settings-section="appearance"]').click();
    await $('[data-settings-section="ai"]').click();
    await refresh().waitForDisplayed();
    assert.equal(requests, before, 'Settings inspection must not perform credential-backed discovery');
    await input().setValue(`http://127.0.0.1:${address.port}/SECRET_ENDPOINT/v1`);
    await refresh().click();
    await expect(panel()).toHaveText(expect.stringContaining('The model server could not be reached. Check its address and connection.'));
    await input().setValue(endpoint);
    mode = 'slow';
    await refresh().click();
    await expect(panel()).toHaveText(expect.stringContaining('The model request timed out. Check the server and try again.'), { wait: 10_000 });
    assert(!(await panel().getText()).includes('SECRET'));
    mode = 'success';
    await refresh().click();
    await $('button[aria-label="Configure native-recovered-model"]').waitForDisplayed();
    assert(!(await panel().getText()).includes('timed out'));
    await navigate('Gneauxght');
  });

  it('shows actionable model-load failures through native HTTP, Pi and the ordinary chat UI', async () => {
    await configurePi(endpoint, 'fixture-load-failure');
    await openPiPane();
    for (const failure of ['memory', 'load'] as const) {
      mode = failure;
      await newPiConversation();
      await sendPiMessage('Say hello. Use no notes or tools.');
      const pane = await waitPiIdle();
      const last = messages(pane).filter(message => message.role === 'assistant').at(-1)!;
      assert.equal(last.stopReason, 'error');
      const expected = failure === 'memory'
        ? 'The model server could not load the selected model into memory. Unload other models, reduce its context size, or choose a smaller model, then retry.'
        : 'The model server could not load the selected model. Load it in the server app or choose another model in Settings, then retry.';
      assert.equal(last.errorMessage, expected);
      await expect($('[data-testid="pi-chat-panel"]')).toHaveText(expect.stringContaining(expected));
      assert(!(await $('[data-testid="pi-chat-panel"]').getText()).includes('SECRET'));
    }
    mode = 'success';
  });

  it('saves an untitled capture, then names it on departure', async () => {
    await activatePiEditor();
    await $('button[aria-label="New Idea. Start a blank note in this pane."]').click();
    const before = requests;
    const inserted = await browser.execute(() => {
      const editor = document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content');
      if (!editor) return false;
      editor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
      editor.focus();
      return document.execCommand('insertText', false, 'Garden capture without AI\n\nCollect rainwater for the tomatoes and watch the seedlings grow each morning.');
    });
    assert(inserted);
    await browser.waitUntil(async () => browser.execute(() => Boolean((window as unknown as { __GNEAUXGHTS_NATIVE_E2E__: { readEditorState(): { noteId: string | null } } }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().noteId)), { timeout: 30_000 });
    await expect($('[data-testid="note-title"]')).toHaveValue('');
    const noteId = await browser.execute(() => (window as unknown as { __GNEAUXGHTS_NATIVE_E2E__: { readEditorState(): { noteId: string } } }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().noteId);
    const saved = await invokeNative<{ title: string; markdown: string; path: string }>('read_note', { noteId, path: null });
    assert.equal(saved.title, '');
    assert(saved.path.endsWith(`Untitled Note ${noteId}.md`));
    await $('button[aria-label="New Idea. Start a blank note in this pane."]').click();
    const named = await invokeNative<{ title: string; markdown: string; path: string }>('read_note', { noteId, path: null });
    assert.equal(named.title, 'Garden capture without AI');
    assert(named.path.endsWith('Garden capture without AI.md'));
    assert.equal(named.markdown, saved.markdown);
    assert(saved.markdown.includes('Collect rainwater'));
    assert.equal(requests, before, 'Capture must not contact the provider');
  });

  it('preserves cancellation and subsequent generation through the shared native provider', async () => {
    const provider = await startPiProviderFixture();
    try {
      await configurePi(provider.endpoint, provider.model);
      await openPiPane();
      await sendPiMessage('fixture-hold');
      await browser.waitUntil(async () => provider.requests > 0 && Boolean(live(await paneState())?.run));
      await browser.waitUntil(async () => Boolean(await $('[data-testid="pi-assistant-message"][data-streaming="true"] .gn-markdown-surface').getText()));
      await $('[data-testid="pi-stop"]').click();
      const stopped = await waitPiIdle();
      assert(messages(stopped).some(message => message.role === 'assistant' && message.stopReason === 'aborted'));
      await newPiConversation();
      await sendPiMessage('fixture-ordinary-after-stop');
      const recovered = await waitPiIdle();
      assert(assistantText(recovered).includes('Fixture ordinary answer. Finished.'));
      assert.equal(messages(recovered).filter(message => message.role === 'assistant').at(-1)?.stopReason, 'stop');
    } finally { await provider.close(); }
  });
});

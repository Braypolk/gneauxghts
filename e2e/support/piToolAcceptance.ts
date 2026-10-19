import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser } from '@wdio/globals';
import { invokeNative } from './liveNative';
import { LOCAL_PI_MODEL, configurePi, assertDisposable, assistantText, messages, newPiConversation, observePi, openPiPane, paneState, savePiFixtureNote, sendPiMessage, waitPiIdle, writePiReport } from './piChatAcceptance';

export function definePiToolAcceptance(provider: 'openai' | 'local' | 'subscription') {
  const accepted = process.env[provider === 'subscription' ? 'GNEAUX_PI_SUBSCRIPTION_ACCEPTANCE' : provider === 'openai' ? 'GNEAUX_PI_HOSTED_ACCEPTANCE' : 'GNEAUX_PI_LOCAL_ACCEPTANCE'] === '1' ? describe : describe.skip;
  const model = provider === 'subscription' ? process.env.GNEAUX_PI_SUBSCRIPTION_MODEL ?? 'gpt-6-luna' : provider === 'openai' ? 'gpt-6-luna' : LOCAL_PI_MODEL;
  accepted(`ordinary Pi tools with actual ${model}`, function () {
    let vault: string;
    this.timeout(420_000);
    before(async function () {
      // This opt-in human sign-in lane must keep the app and its OS permission
      // dialog alive if the user answers later. Inference keeps its short deadlines.
      if (provider === 'subscription') this.timeout(86_460_000);
      vault = join(await assertDisposable(), 'documents/vault');
      await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
      if (provider === 'local') await configurePi();
      else {
        if (provider === 'subscription') {
          const status = await invokeNative<{ connected: boolean }>('chat_chatgpt_status');
          if (!status.connected) {
            // A human OAuth flow exceeds WebDriver's script timeout. Start it
            // exactly once, then poll only its nonsecret completion status.
            await browser.execute(() => {
              const host = window as typeof window & { __chatGptLogin?: { done: boolean; error?: string } };
              host.__chatGptLogin = { done: false };
              void window.__TAURI_INTERNALS__!.invoke('chat_chatgpt_login', {}).then(
                () => { host.__chatGptLogin = { done: true }; },
                error => { host.__chatGptLogin = { done: true, error: String(error) }; }
              );
            });
            await browser.waitUntil(() => browser.execute(() => Boolean((window as typeof window & { __chatGptLogin?: { done: boolean } }).__chatGptLogin?.done)), { timeout: 310_000, interval: 1000, timeoutMsg: 'Complete ChatGPT sign-in in the browser before running subscription acceptance' });
            const failure = await browser.execute(() => (window as typeof window & { __chatGptLogin?: { error?: string } }).__chatGptLogin?.error);
            assert(!failure, failure);
          }
          await invokeNative('chat_set_openai_auth', { method: 'chatgpt' });
          // macOS may ask a human to unlock this development executable's
          // Keychain access. Do not replay that native read on a 30-second timeout.
          await browser.setTimeout({ script: 86_400_000 });
          let catalog: Array<{ id: string }>;
          try { catalog = await invokeNative<Array<{ id: string }>>('chat_list_openai_models', { modelIds: [] }); }
          finally { await browser.setTimeout({ script: 30_000 }); }
          assert(catalog.some(entry => entry.id === model), `The signed-in ChatGPT account must offer ${model}`);
          assert.equal(await invokeNative('chat_openai_auth_method'), 'chatgpt');
        } else {
          const key = await invokeNative<{ configured: boolean }>('chat_get_key_status', { provider: 'openai' });
          assert(key.configured, 'Live hosted acceptance requires a native OpenAI credential (OPENAI_API_KEY in debug builds)');
          await invokeNative('chat_set_openai_auth', { method: 'apiKey' });
        }
        const settings = await invokeNative<Record<string, unknown>>('chat_get_settings');
        await invokeNative('chat_set_defaults', { defaults: { ...settings, provider: 'openai', model, openaiModel: model, defaultAccess: 'full', reasoningEffort: 'medium' } });
      }
      await invokeNative('pi_chat_set_write_defaults', { write: {
        grant: { duration: 'always', operations: ['update', 'create'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying: true
      } });
      await openPiPane(); await observePi();
    });
    afterEach(async function () {
      if (provider === 'subscription') assert.equal(await invokeNative('chat_openai_auth_method'), 'chatgpt', 'Subscription tests must never fall back to an API key');
      const pane = await paneState();
      await writePiReport(`pi-${provider}-${this.currentTest!.title.includes('pagination') ? 'pagination' : this.currentTest!.title.includes('creates') ? 'create' : 'edit'}`, {
        kind: `live-${provider}`, model, passed: this.currentTest!.state === 'passed', conversationId: pane.conversationId,
        answer: assistantText(pane), error: pane.error,
        tools: messages(pane).filter(message => message.role === 'toolResult'),
        calls: messages(pane).filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'toolCall'))
      });
    });
    it('finds Edit check and reviews a 45-minute walk change from the original user request', async () => {
      const note = await savePiFixtureNote('Edit check', '# Routine\n\nWalk for 30 minutes.\n\nKeep the water reminder unchanged.\n');
      await sendPiMessage('In edit check change the walk to 45 minutes');
      const review = await $('[data-testid="pi-edit-review"]');
      await browser.waitUntil(async () => {
        const pane = await paneState();
        const failed = messages(pane).find(message => message.role === 'assistant' && message.stopReason === 'error');
        return Boolean(failed) || review.isDisplayed();
      }, { timeout: 180_000, timeoutMsg: 'Live model did not reach note edit review' });
      const failed = messages(await paneState()).find(message => message.role === 'assistant' && message.stopReason === 'error');
      assert(!failed, failed?.role === 'assistant' ? failed.errorMessage : 'Live provider request failed');
      assert((await review.getText()).includes('45'));
      assert(readFileSync(note.path, 'utf8').includes('Walk for 30 minutes.'), 'A live model must not publish before review');
      await $('button*=Apply edit').click();
      const pane = await waitPiIdle(180_000);
      const tools = messages(pane).filter(message => message.role === 'toolResult');
      assert(tools.some(tool => tool.toolName === 'search_notes' && !tool.isError));
      assert(tools.some(tool => tool.toolName === 'read_note' && !tool.isError));
      const edit = tools.find(tool => tool.toolName === 'edit_note');
      assert(edit && !edit.isError, 'Live model must complete the actual edit tool');
      assert(tools.every(tool => !tool.isError), 'Original request must not loop on tool argument errors');
      const canonical = readFileSync(note.path, 'utf8');
      assert(canonical.includes('Walk for 45 minutes.'));
      assert(!canonical.includes('Walk for 30 minutes.'));
      assert(canonical.includes('Keep the water reminder unchanged.'));
      assert(assistantText(pane).includes('45'));
      assert.equal(pane.error, null);
      await $('[data-pi-source]').waitForExist();
      await $('[data-pi-source]').click();
      await browser.waitUntil(async () => browser.execute((id: string) =>
        (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__: { readEditorState(): { noteId: string | null } } }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().noteId === id,
      note.noteId), { timeout: 30_000, timeoutMsg: 'Live model citation did not open the edited note' });
    });
    it('accepts an empty first-page cursor and follows native pagination tokens unchanged', async () => {
      for (const [index, code] of ['AMBER-742', 'BLUE-815', 'GREEN-926', 'VIOLET-637'].entries()) {
        await savePiFixtureNote(`Pagination lantern ${index + 1}`, `cursorpaginationprobe\n\nThe beacon code is ${code}.\n`);
      }
      await newPiConversation();
      await sendPiMessage('Find all saved notes containing cursorpaginationprobe. Use search_notes with query "cursorpaginationprobe" and limit 1. For this pagination check, explicitly send cursor as an empty string on the first search, then copy each returned nextCursor exactly to fetch the next page until nextCursor is null. Read every matching note and report its beacon code with the returned citation.');
      const pane = await waitPiIdle(240_000);
      const transcript = messages(pane);
      const searches = transcript.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'toolCall')).filter(call => call.name === 'search_notes');
      assert(searches.length >= 4 && searches.length <= 6, 'Live model must complete the four-page search without looping');
      assert.equal(searches[0].arguments.cursor, '');
      for (let index = 0; index < searches.length; index++) {
        const call = searches[index];
        assert.equal(call.arguments.query, 'cursorpaginationprobe');
        assert.equal(call.arguments.limit, 1);
        const result = transcript.find(message => message.role === 'toolResult' && message.toolCallId === call.id);
        assert(result?.role === 'toolResult' && !result.isError, 'Every native paginated search must succeed');
        const output = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join(''));
        if (index + 1 < searches.length) assert.equal(searches[index + 1].arguments.cursor, output.nextCursor);
        else assert.equal(output.nextCursor, null);
      }
      for (const code of ['AMBER-742', 'BLUE-815', 'GREEN-926', 'VIOLET-637']) assert(assistantText(pane).includes(code));
      assert.equal(pane.error, null);
    });
    it('creates a root note only after review and returns a fresh canonical citation', async () => {
      await newPiConversation();
      const title = 'Provider tool creation';
      const path = join(vault, `${title}.md`);
      await sendPiMessage(`Create a new note titled "${title}" in the vault root. Its complete Markdown content must be "# Beacon plan\n\nWalk for 45 minutes.\n\nBeacon code: CREATE-583.\n". Use create_note. Leave the optional folder unset or null for the root. After I approve the review, confirm with the returned fresh citation.`);
      const review = await $('[data-testid="pi-edit-review"]');
      await browser.waitUntil(async () => {
        const pane = await paneState();
        return messages(pane).some(message => message.role === 'assistant' && message.stopReason === 'error') || review.isDisplayed();
      }, { timeout: 180_000, timeoutMsg: 'Live model did not reach note creation review' });
      const failed = messages(await paneState()).find(message => message.role === 'assistant' && message.stopReason === 'error');
      assert(!failed, failed?.role === 'assistant' ? failed.errorMessage : 'Live provider request failed');
      assert((await review.getText()).includes(`Create ${title}`));
      assert((await $('[aria-label="New note content"]').getText()).includes('CREATE-583'));
      assert(!existsSync(path), 'Creation must wait for human approval');
      await $('button=Create note').click();
      const pane = await waitPiIdle(180_000);
      const tools = messages(pane).filter(message => message.role === 'toolResult');
      assert(tools.every(tool => !tool.isError), 'Creation must not loop on argument errors');
      const created = tools.filter(tool => tool.toolName === 'create_note');
      assert.equal(created.length, 1, 'A single request must create exactly once');
      const result = JSON.parse(created[0].content.filter(block => block.type === 'text').map(block => block.text).join(''));
      assert.equal(result.status, 'committed');
      const canonical = readFileSync(path, 'utf8');
      assert(canonical.includes('# Beacon plan\n\nWalk for 45 minutes.\n\nBeacon code: CREATE-583.'));
      assert.equal(result.read.markdown, canonical);
      assert(result.read.source.noteId && result.read.citation);
      assert.equal(await $('[data-pi-source]').getAttribute('data-pi-source'), result.read.source.sourceId);
      assert.equal(pane.error, null);
    });
  });
}

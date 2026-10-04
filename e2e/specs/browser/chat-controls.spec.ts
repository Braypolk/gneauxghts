import { browser, expect, $ } from '@wdio/globals';

async function invocations(command: string) {
  return browser.execute(name => window.__GNEAUXGHTS_E2E__!.invocations.filter(item => item.command === name), command);
}
async function openChat() {
  await browser.execute(() => {
    document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter'));
  });
  const split = await $('button[aria-label="Split with thought partner"]');
  await split.waitForDisplayed(); await split.click();
  await $('[data-pane-kind="chat"] textarea').waitForEnabled();
}
async function send(content: string) {
  const composer = await $('[data-pane-kind="chat"] textarea');
  await composer.setValue(content);
  await $('button[aria-label="Send message"]').click();
}

describe('chat mounted controls', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/');
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist({ timeout: 30_000 });
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
  });

  it('creates a draft conversation, sends exactly once and navigates from its evidence', async () => {
    await openChat();
    await send('Explain this note');
    await browser.waitUntil(async () => (await invocations('chat_send_message')).length === 1);
    await expect($('[data-chat-message-id="controls-assistant-1"]')).toHaveText(expect.stringContaining('Fixture answer with evidence.'));
    await expect($('[data-pane-kind="chat"] textarea')).toHaveValue('');
    expect(await invocations('chat_create_conversation')).toHaveLength(1);
    const calls = await invocations('chat_send_message');
    expect(calls[0].args.request).toMatchObject({ conversationId: 'controls-chat', content: 'Explain this note', activeNote: { noteId: 'note-alpha' } });
    await $('[data-chat-message-id="controls-assistant-1"]').$('button*=Show evidence').click();
    await $('section[aria-label="Evidence from Beta note"] button[data-slot="inline-citation"]').click();
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
  });

  it('retains the draft and sends nothing when active-note flush fails', async () => {
    await openChat();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.holdSave(true));
    try {
      const editor = await $('[data-testid="note-editor"] .cm-content');
      await editor.click(); await browser.keys('Unsaved chat context');
      await send('Keep this draft');
      await browser.waitUntil(async () => (await invocations('save_note')).length > 0);
      expect(await invocations('chat_send_message')).toHaveLength(0);
      await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave());
      await $('[data-pane-kind="chat"] [role="alert"]').waitForDisplayed();
      await expect($('[data-pane-kind="chat"] textarea')).toHaveValue('Keep this draft');
      expect(await invocations('chat_send_message')).toHaveLength(0);
    } finally {
      await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave());
    }
  });

  it('passes the complete runtime permission identity from the visible decision button', async () => {
    await openChat(); await send('Permission scenario');
    const allow = await $('[aria-label="Decide permission for Fixture permission"]').$('button=Allow once');
    await allow.waitForDisplayed(); await allow.click();
    await browser.waitUntil(async () => (await invocations('chat_decide_permission')).length === 1);
    const calls = await invocations('chat_decide_permission');
    expect(calls[0].args.command).toMatchObject({ permissionId: 'controls-permission', requestId: 'controls-request-1', conversationId: 'controls-chat', messageId: 'controls-assistant-1', runId: 'controls-run', toolCallId: 'controls-call', decision: 'allowOnce' });
  });

  it('discovers and configures local model capabilities through mounted Settings controls', async () => {
    await $('a[aria-label="Settings"]').click();
    await $('[data-settings-section="ai"]').click();
    const provider = await $('[data-settings-anchor="chat-provider"] select');
    await provider.waitForExist(); await provider.selectByAttribute('value', 'local');
    const configure = await $('button[aria-label="Configure fixture-local"]');
    await configure.waitForDisplayed(); await configure.click();
    const vision = await $('button[aria-label="Vision capability"]');
    await vision.waitForDisplayed(); await vision.click();
    await $('button=Save changes').click();
    await browser.waitUntil(async () => (await invocations('chat_set_local_model_capabilities')).length === 1);
    const calls = await invocations('chat_set_local_model_capabilities');
    expect(calls[0].args).toMatchObject({ model: 'fixture-local', capabilities: { images: true, tools: true, audio: false, video: false } });
  });
});

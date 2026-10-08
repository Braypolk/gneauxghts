import { browser, expect, $, $$ } from '@wdio/globals';

async function invocations(command: string) {
  return browser.execute(name => window.__GNEAUXGHTS_E2E__!.invocations.filter(item => item.command === name), command);
}
async function openChat() {
  await browser.execute(() => {
    document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter'));
  });
  const split = await $('button[aria-label="Split with thought partner"]');
  await split.waitForDisplayed(); await split.click();
  await $('[data-notepad-command-bar] textarea').waitForEnabled();
}
async function send(content: string) {
  const composer = await $('[data-notepad-command-bar] textarea');
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
    await expect($('[data-notepad-command-bar] textarea')).toHaveValue('');
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
      await $('[data-notepad-command-bar] [role="alert"]').waitForDisplayed();
      await expect($('[data-notepad-command-bar] textarea')).toHaveValue('Keep this draft');
      expect(await invocations('chat_send_message')).toHaveLength(0);
    } finally {
      await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave());
    }
  });

  it('shows context details below the response and reveals branching on hover', async () => {
    await openChat();
    await send('Explain this note');
    const response = await $('[data-chat-message-id="controls-assistant-1"]');
    await response.waitForDisplayed();
    const context = await response.$('button[aria-label="Show context usage"]');
    await expect(context).toHaveText('Context 8K');
    await context.click();
    const details = await $('[aria-label="Context usage details"]');
    await details.waitForDisplayed();
    await expect(details).toHaveText(expect.stringContaining('8,000'));
    await expect(details).toHaveText(expect.stringContaining('limit not reported'));
    await expect(details).toHaveText(expect.stringContaining('8,400'));
    await browser.keys('Escape');
    await details.waitForDisplayed({ reverse: true });
    await expect(response.$('time')).toExist();
    expect(await response.$('time').getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await $('[data-notepad-command-bar] textarea').click();
    const branch = await response.$('button[aria-label="Branch from here"]');
    await browser.waitUntil(async () => Number((await branch.getCSSProperty('opacity')).value) === 0);
    await response.moveTo();
    await browser.waitUntil(async () => Number((await branch.getCSSProperty('opacity')).value) === 1);
    await expect(response.$('.chat-message-footer button[aria-label="Copy message as Markdown"]')).toBeDisplayed();
  });

  it('keeps the draft while selecting a model and adjusting reasoning with the keyboard', async () => {
    await openChat();
    const composer = await $('[data-notepad-command-bar] textarea');
    await composer.setValue('Keep this thought while configuring');
    await $('button[aria-label="AI model"]').click();
    await $('[aria-label="AI model picker"]').$('button*=5.6 Terra').click();
    await expect($('button[aria-label="AI model"]')).toHaveText('5.6 Terra');
    await $('button[aria-label="Reasoning effort"]').click();
    const slider = await $('input[aria-label="Reasoning effort level"]');
    await slider.waitForDisplayed();
    await browser.keys('Tab');
    await browser.keys('ArrowRight');
    await expect($('button[aria-label="Reasoning effort"]')).toHaveText(expect.stringContaining('High'));
    await expect(composer).toHaveValue('Keep this thought while configuring');
    expect(await invocations('chat_send_message')).toHaveLength(0);
    await $('button[aria-label="Send message"]').click();
    await browser.waitUntil(async () => (await invocations('chat_create_conversation')).length === 1);
    const calls = await invocations('chat_create_conversation');
    expect(calls[0].args.request).toMatchObject({ model: 'gpt-5.6-terra', reasoningEffort: 'high' });
    await expect(composer).toHaveValue('');
  });

  it('browses providers in the combined model menu and applies them only when choosing a model', async () => {
    await openChat();
    const composer = await $('[data-notepad-command-bar] textarea');
    await composer.setValue('Keep this thought while choosing a provider');
    await expect($$('.chat-model-selector > div > button')).toBeElementsArrayOfSize(2);
    await $('button[aria-label="AI model"]').click();
    await $('[aria-label="AI provider picker"]').$('button=Local').click();
    await expect($('button[aria-label="AI model"]')).toHaveText('5.6 Sol');
    await browser.keys('Escape');
    await $('button[aria-label="AI model"]').click();
    await expect($('[aria-label="AI provider picker"]').$('button=ChatGPT')).toHaveAttribute('aria-pressed', 'true');
    await $('[aria-label="AI provider picker"]').$('button=Local').click();
    await $('[aria-label="AI model picker"]').$('button*=fixture-local').click();
    await expect($('button[aria-label="AI model"]')).toHaveText('fixture-local');
    await expect($('button[aria-label="Reasoning effort"]')).not.toExist();
    await expect(composer).toHaveValue('Keep this thought while choosing a provider');
    await $('button[aria-label="Send message"]').click();
    await browser.waitUntil(async () => (await invocations('chat_create_conversation')).length === 1);
    const calls = await invocations('chat_create_conversation');
    expect(calls[0].args.request).toMatchObject({ provider: 'local', model: 'fixture-local' });
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

import { browser, expect, $ } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import type { SemanticStatus } from '../../../src/lib/types/semantic';

const search = () => $('input[aria-label="Search settings"]');
const category = (id: string) => $(`[data-settings-section="${id}"]`);

async function expectDestination(anchor: string) {
  await browser.waitUntil(async () => browser.execute((expected) =>
    document.activeElement?.getAttribute('data-settings-anchor') === expected, anchor));
  expect(await search().getValue()).toBe('');
}

async function installChatFixture() {
  await browser.execute(() => {
    const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    const original = native.invoke;
    native.invoke = async (cmd, args) => {
      if (cmd === 'chat_get_settings') return { provider: 'openai', model: 'gpt-5.4', defaultAccess: 'full', openaiModel: 'gpt-5.4' };
      if (cmd === 'chat_get_key_status') return { configured: false };
      if (cmd === 'chat_list_note_policies') return [];
      return original(cmd, args);
    };
  });
}

describe('searchable settings workspace', () => {
  beforeEach(async () => {
    await browser.url('/settings');
    await search().waitForDisplayed({ timeout: 30_000 });
    await category('appearance').click();
  });

  it('finds individual settings and keyboard actions, with keyboard and empty-state recovery', async () => {
    await search().setValue('font');
    await $('[data-settings-result="text-size"]').waitForDisplayed();
    await browser.keys('Enter');
    await expectDestination('text-size');
    await search().setValue('no-such-setting-xyz');
    await $('h3=No settings found').waitForDisplayed();
    await browser.keys('Escape');
    expect(await search().getValue()).toBe('');
    expect(await search().isFocused()).toBe(true);
    await search().setValue('undo');
    await $('[data-settings-result="shortcut-editorUndo"]').click();
    await expectDestination('shortcut-editorUndo');
    await $('input[placeholder="Filter shortcuts"]').setValue('does not exist');
    await search().setValue('redo');
    await $('[data-settings-result="shortcut-editorRedo"]').click();
    await expectDestination('shortcut-editorRedo');
    const shortcut = await $('[data-settings-anchor="shortcut-editorRedo"]');
    await shortcut.$('button=Clear').click();
    await shortcut.$('span=Disabled').waitForDisplayed();
    await shortcut.$('button=Reset').click();
    expect(await shortcut.$('button=Clear').isDisplayed()).toBe(true);
    expect(await shortcut.$('button=Reset').isExisting()).toBe(false);
  });

  it('opens recovery and diagnostic destinations without invoking their actions', async () => {
    await search().setValue('trash');
    await $('[data-settings-result="forgotten"]').click();
    await expectDestination('forgotten-items');
    await search().setValue('diagnostics');
    await $('[data-settings-result="diagnostics"]').click();
    await expectDestination('semantic-diagnostics');
    expect(await $('[data-settings-anchor="semantic-diagnostics"]').getAttribute('open')).not.toBeNull();
    await search().setValue('clear vault history');
    await browser.keys('Enter');
    await expectDestination('clear-history');
    await search().setValue('running vault');
    await $('[data-settings-result="vault-details"]').click();
    await expectDestination('vault-details');
    expect(await $('[data-settings-anchor="vault-details"]').getAttribute('open')).not.toBeNull();
    const destructive = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter((entry) =>
      ['clear_vault_history', 'delete_forgotten_notes', 'delete_missing_notes', 'reset_corrupt_history'].includes(entry.command)));
    expect(destructive).toHaveLength(0);
  });

  it('explains complete timeline deletion before confirming a forgotten item purge', async () => {
    await category('forgotten').click();
    const panel = await $('[data-settings-anchor="forgotten-items"]');
    const deleteButton = await panel.$('button=Permanently delete');
    await deleteButton.waitForDisplayed();
    await deleteButton.click();
    const warning = await panel.$('p*=complete Note Timeline');
    await warning.waitForDisplayed();
    expect(await warning.getText()).toContain('cannot be undone');
    await panel.$('button=Cancel').click();
    await warning.waitForExist({ reverse: true });
    expect(await deleteButton.isDisplayed()).toBe(true);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(
      entry => entry.command === 'delete_forgotten_notes'
    ))).toHaveLength(0);
  });

  it('preserves unsaved credentials and defaults while searching', async () => {
    await installChatFixture();
    await search().setValue('API key');
    await $('[data-settings-result="api-keys"]').click();
    await expectDestination('api-keys');
    await $('#provider-api-key').setValue('draft-only-not-a-real-key');
    const model = await $('input[list="openai-chat-models"]');
    await model.setValue('unsaved-model');
    await search().setValue('font');
    await $('button[aria-label="Clear settings search"]').click();
    expect(await $('#provider-api-key').getValue()).toBe('draft-only-not-a-real-key');
    expect(await model.getValue()).toBe('unsaved-model');
    await search().setValue('reasoning');
    await $('[data-settings-result="reasoning"]').click();
    await expectDestination('chat-defaults');
    expect(await model.getValue()).toBe('unsaved-model');
  });

  it('keeps semantic controls focused, reveals maintenance from search, and preserves action wiring', async () => {
    await $('label:has(input[name="theme-preference"][value="light"])').click();
    const contract = JSON.parse(readFileSync('src-tauri/test-fixtures/contracts/app-events.json', 'utf8'));
    const status = contract.events.find((event: { channel: string }) => event.channel === 'semantic-status-changed').payload as SemanticStatus;
    status.lastIndexedAtMillis = Date.now() - 60_000;
    await browser.execute((initial) => {
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const original = native.invoke;
      const status = initial;
      native.invoke = async (cmd, args) => {
        const result = await original(cmd, args);
        if (cmd === 'get_settings_view') return { ...(result as object), semanticStatus: status, semanticSettings: status.settings };
        if (cmd === 'get_semantic_status') return status;
        if (cmd === 'set_semantic_settings') {
          status.settings = (args as { settings: typeof status.settings }).settings;
          return status.settings;
        }
        if (cmd === 'pause_semantic_indexing' || cmd === 'resume_semantic_indexing') {
          status.indexingPaused = cmd === 'pause_semantic_indexing';
          status.health = status.indexingPaused ? 'paused' : 'fresh';
        }
        if (cmd === 'download_semantic_embedding_model') return { alreadyPresent: true, path: '/app/models/jina.gguf' };
        return result;
      };
    }, status);
    await category('search').click();
    await $('button[aria-label="Refresh semantic search"]').click();
    await $('h3=Ready to use').waitForDisplayed();
    expect(await $('button=Rebuild semantic index').isDisplayed()).toBe(false);
    expect(await $('dt=Runtime').isDisplayed()).toBe(false);
    await browser.saveScreenshot('/tmp/gneauxghts-semantic-redesign.png');
    await category('appearance').click();
    await $('label:has(input[name="theme-preference"][value="dark"])').click();
    await category('search').click();
    await browser.waitUntil(async () => browser.execute(() => getComputedStyle(document.querySelector('.settings-nav-item.active')!).color === 'oklch(1 0 0)'));
    await browser.saveScreenshot('/tmp/gneauxghts-semantic-dark.png');
    await category('appearance').click();
    await $('label:has(input[name="theme-preference"][value="light"])').click();
    await category('search').click();
    await $('.semantic-switch').click();
    await browser.waitUntil(async () => !(await $('[role="switch"]').isSelected()));
    await $('h3=Semantic search is off').waitForDisplayed();
    await $('.semantic-switch').click();
    await $('h3=Ready to use').waitForDisplayed();
    expect(await $('button=Pause indexing').isExisting()).toBe(false);
    expect(await $('button=Prepare local model').isDisplayed()).toBe(false);
    await search().setValue('pause indexing');
    await $('[data-settings-result="automatic-indexing"]').click();
    await expectDestination('semantic-background');
    await $('button=Pause automatic updates').click();
    await $('h3=Automatic indexing is paused').waitForDisplayed();
    await $('button=Resume indexing').click();
    await $('h3=Ready to use').waitForDisplayed();
    await search().setValue('clear map cache');
    await $('[data-settings-result="cache"]').click();
    await expectDestination('semantic-cache');
    expect(await $('[data-settings-anchor="semantic-maintenance"]').getAttribute('open')).not.toBeNull();
    await $('button=Clear map cache').click();
    await $('p*=Map cache cleared').waitForDisplayed();
    await $('button=Rebuild semantic index').click();
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(entry => entry.command === 'rebuild_semantic_index')));
    await search().setValue('download model');
    await $('[data-settings-result="download-model"]').click();
    await expectDestination('semantic-download');
    await $('button=Download embedding model').click();
    await $('p=Embedding model is already installed.').waitForDisplayed();
    await search().setValue('embedding model');
    await $('[data-settings-result="embedding"]').click();
    await expectDestination('semantic-model');
    await search().setValue('prepare local model');
    await $('[data-settings-result="prepare-model"]').click();
    await expectDestination('semantic-prepare');
    await $('button=Prepare local model').click();
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(entry => entry.command === 'prepare_semantic_model')));
    await search().setValue('diagnostics');
    await $('[data-settings-result="diagnostics"]').click();
    await expectDestination('semantic-diagnostics');
    await $('dd=/app/llama-server').waitForDisplayed();
    await browser.saveScreenshot('/tmp/gneauxghts-semantic-diagnostics.png');
    try {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await category('search').scrollIntoView();
      await category('search').click();
      await browser.execute(() => {
        document.querySelectorAll<HTMLDetailsElement>('.semantic-disclosure').forEach(details => { details.open = false; });
        document.querySelector<HTMLElement>('.settings-content')!.scrollTop = 0;
      });
      await browser.saveScreenshot('/tmp/gneauxghts-semantic-mobile.png');
      const fits = await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>('.semantic-panel')!;
        return { width: panel.clientWidth, scroll: panel.scrollWidth };
      });
      expect(fits.scroll).toBeLessThanOrEqual(fits.width);
      await search().setValue('clear map cache');
      await $('[data-settings-result="cache"]').click();
      await expectDestination('semantic-cache');
      expect(await $('button=Clear map cache').isDisplayed()).toBe(true);
    } finally {
      await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    }
  });

  it('retains theme choices and fits every category on a narrow screen', async () => {
    await $('label:has(input[name="theme-preference"][value="light"])').click();
    await browser.waitUntil(async () => browser.execute(() => getComputedStyle(document.querySelector('.settings-nav-item.active')!).color === 'oklch(0 0 0)'));
    await browser.saveScreenshot('/tmp/gneauxghts-settings-light.png');
    await $('label:has(input[name="theme-preference"][value="dark"])').click();
    await browser.waitUntil(async () => browser.execute(() => getComputedStyle(document.querySelector('.settings-nav-item.active')!).color === 'oklch(1 0 0)'));
    await browser.saveScreenshot('/tmp/gneauxghts-settings-dark.png');
    await browser.refresh();
    await search().waitForDisplayed();
    expect(await $('input[name="theme-preference"][value="dark"]').isSelected()).toBe(true);
    await $('label:has(input[name="theme-preference"][value="light"])').click();
    await installChatFixture();
    for (const id of ['ai', 'search', 'vault', 'history', 'forgotten', 'shortcuts']) {
      await category(id).click();
      if (id === 'ai') await $('#provider-api-key').waitForDisplayed();
      await browser.saveScreenshot(`/tmp/gneauxghts-settings-${id}.png`);
    }
    await search().setValue('privacy');
    await $('[data-settings-result="excluded"]').waitForDisplayed();
    await browser.saveScreenshot('/tmp/gneauxghts-settings-results.png');
    await category('appearance').click();
    const original = await browser.getWindowSize();
    try {
      // Chrome's desktop window has a minimum width. Override the viewport so
      // this exercises a real phone width rather than a clamped 500px window.
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      expect(await browser.execute(() => innerWidth)).toBe(390);
      await browser.saveScreenshot('/tmp/gneauxghts-settings-mobile.png');
      await installChatFixture();
      for (const id of ['appearance', 'shortcuts', 'forgetting', 'ai', 'search', 'vault', 'history', 'forgotten']) {
        const button = await category(id);
        await button.scrollIntoView();
        await button.click();
        const dimensions = await browser.execute(() => {
          const content = document.querySelector<HTMLElement>('.settings-content')!;
          return { width: content.clientWidth, scroll: content.scrollWidth, right: content.getBoundingClientRect().right, viewport: innerWidth };
        });
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
        expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
      }
      await search().setValue('font');
      await $('[data-settings-result="text-size"]').click();
      await expectDestination('text-size');
    } finally {
      await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
      await browser.setWindowSize(original.width, original.height);
    }
  });
});

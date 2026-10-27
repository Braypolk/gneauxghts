import { browser, expect, $ } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
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

  it('lists Pi OpenAI defaults with their names while preserving the saved model and custom entry', async () => {
    await installChatFixture();
    await category('ai').click();
    const model = await $('input[list="openai-chat-models"]');
    await model.waitForDisplayed();
    expect(await model.getValue()).toBe('gpt-5.4');
    const options = await browser.execute(() => Array.from(document.querySelectorAll<HTMLDataListElement>('#openai-chat-models option'), option => ({
      id: option.getAttribute('value'), label: option.textContent
    })));
    expect(options).toEqual(openaiProvider().getModels().map(model => ({ id: model.id, label: model.name })));
    await model.setValue('gpt-6-luna');
    expect(await $('[data-settings-anchor="chat-reasoning"] option[value="max"]').isExisting()).toBe(true);
    await model.setValue('custom-openai-model');
    expect(await model.getValue()).toBe('custom-openai-model');
  });

  it('connects ChatGPT, switches billing methods and disconnects while retaining the API key controls', async () => {
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      let method = 'apiKey', connected = false;
      native.invoke = async (command, args) => {
        if (command === 'chat_get_settings') return { ...await original(command, args) as Record<string, unknown>, provider: 'openai' };
        if (command === 'chat_chatgpt_login') { connected = true; method = 'chatgpt'; }
        if (command === 'chat_set_openai_auth') method = (args as { method: string }).method;
        if (command === 'chat_chatgpt_disconnect') { connected = false; method = 'apiKey'; }
        if (['chat_chatgpt_status', 'chat_chatgpt_login', 'chat_set_openai_auth', 'chat_chatgpt_disconnect'].includes(command)) return { method, connected, supported: true, login: { phase: 'idle', browserUrl: null, manualInput: false, error: null } };
        if (command === 'chat_list_openai_models') return [{ id: 'subscription-test-model', ownedBy: 'openai' }];
        return original(command, args);
      };
    });
    await search().setValue('ChatGPT subscription');
    await $('[data-settings-result="chatgpt-sign-in"]').click();
    await $('button=Continue with ChatGPT').click();
    await browser.waitUntil(async () => (await $('[data-testid="chatgpt-status"]').getText()).includes('Using ChatGPT subscription'));
    expect(await $('input#provider-api-key').isExisting()).toBe(true);
    expect(await $('[data-settings-anchor="chat-processing"]').isExisting()).toBe(false);
    expect(await $('option[value="subscription-test-model"]').isExisting()).toBe(true);
    await $('button=Use API key').click();
    await $('[data-settings-anchor="chat-processing"]').waitForExist();
    expect(await $('[data-testid="chatgpt-status"]').getText()).toContain('ChatGPT connected');
    expect(await $('button=Continue with ChatGPT').isExisting()).toBe(false);
    expect(await $('button=Reconnect ChatGPT').isExisting()).toBe(false);
    await $('button=Use ChatGPT subscription').click();
    await $('button=Disconnect ChatGPT').click();
    await browser.waitUntil(async () => (await $('[data-testid="chatgpt-status"]').getText()).includes('ChatGPT not connected'));
    expect(await $('input#provider-api-key').isExisting()).toBe(true);
  });

  it('opens saved ChatGPT settings without unlocking credentials or refreshing models', async () => {
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      let checks = 0;
      native.invoke = async (command, args) => {
        if (command === 'chat_chatgpt_status') return { method: 'chatgpt', connected: true, supported: true, login: { phase: 'idle', browserUrl: null, manualInput: false, error: null } };
        if (command === 'chat_list_openai_models') { checks++; return [{ id: 'gpt-6-luna' }]; }
        return original(command, args);
      };
      (window as unknown as { __connectionChecks: () => number }).__connectionChecks = () => checks;
    });
    await category('ai').click();
    await $('button=Check connection').waitForDisplayed();
    expect(await $('button=Reconnect ChatGPT').isExisting()).toBe(false);
    expect(await $('button=Continue with ChatGPT').isExisting()).toBe(false);
    await category('appearance').click();
    await category('ai').click();
    await $('button=Check connection').waitForDisplayed();
    expect(await browser.execute(() => (window as unknown as { __connectionChecks: () => number }).__connectionChecks())).toBe(0);
    await $('button=Check connection').click();
    await browser.waitUntil(async () => (await $('[data-testid="chatgpt-sign-in"]').getText()).includes('Connection checked.'));
    expect(await browser.execute(() => (window as unknown as { __connectionChecks: () => number }).__connectionChecks())).toBe(1);
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      native.invoke = async (command, args) => {
        if (command === 'chat_list_openai_models') throw new Error('OpenAI is temporarily unavailable');
        return original(command, args);
      };
    });
    await $('button=Check connection').click();
    await browser.waitUntil(async () => (await $('[data-testid="chatgpt-sign-in"]').getText()).includes('OpenAI is temporarily unavailable'));
    expect(await $('button=Continue with ChatGPT').isExisting()).toBe(false);
    expect(await $('button=Reconnect ChatGPT').isExisting()).toBe(false);
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      native.invoke = async (command, args) => {
        if (command === 'chat_list_openai_models') throw new Error('Reconnect ChatGPT to continue');
        if (command === 'chat_chatgpt_status') return { method: 'chatgpt', connected: false, supported: true, login: { phase: 'idle', browserUrl: null, manualInput: false, error: null } };
        return original(command, args);
      };
    });
    await $('button=Check connection').click();
    await browser.waitUntil(async () => (await $('[data-testid="chatgpt-sign-in"]').getText()).includes('Reconnect ChatGPT to continue'));
    expect(await $('[data-testid="chatgpt-sign-in"]').getText()).not.toContain('Connection checked.');
    await $('button=Continue with ChatGPT').waitForDisplayed();
    await category('appearance').click();
    await category('ai').click();
    await $('button=Continue with ChatGPT').waitForDisplayed();
  });

  it('opens saved local-provider settings without credential-backed discovery until Refresh', async () => {
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      const calls: string[] = [];
      native.invoke = async (command, args) => {
        if (command === 'chat_get_settings') return { ...await original(command, args) as Record<string, unknown>, provider: 'local', localModel: 'saved-local-model' };
        if (command === 'chat_get_key_status') return { provider: args.provider, configured: args.provider === 'local' };
        if (['chat_list_local_models', 'chat_get_model_capabilities', 'chat_list_openai_models'].includes(command)) calls.push(command);
        if (command === 'chat_list_local_models') return [{ id: 'saved-local-model' }, { id: 'discovered-local-model' }];
        return original(command, args);
      };
      (window as unknown as { __localDiscoveryCalls: string[] }).__localDiscoveryCalls = calls;
    });
    for (let visit = 0; visit < 2; visit++) {
      await category('ai').click();
      await $('button[aria-label="Configure saved-local-model"]').waitForDisplayed();
      expect(await $('[data-settings-anchor="api-keys"]').getText()).toContain('Key configured');
      expect(await browser.execute(() => (window as unknown as { __localDiscoveryCalls: string[] }).__localDiscoveryCalls)).toEqual([]);
      if (visit === 0) await category('appearance').click();
    }
    await $('button[aria-label="Refresh server models"]').click();
    await $('button[aria-label="Configure discovered-local-model"]').waitForDisplayed();
    await browser.waitUntil(async () => await $('button[aria-label="Refresh server models"]').isEnabled());
    const calls = await browser.execute(() => (window as unknown as { __localDiscoveryCalls: string[] }).__localDiscoveryCalls);
    expect(calls.filter(command => command === 'chat_list_local_models')).toHaveLength(1);
    expect(calls.filter(command => command === 'chat_get_model_capabilities')).toHaveLength(2);
    expect(calls).not.toContain('chat_list_openai_models');
  });

  it('presents curated local connection failures while preserving manual setup and later refresh', async () => {
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      const failures = [
        'The model server hostname could not be resolved. Check the server address and network connection.',
        'The model request timed out. Check the server and try again.',
        'The model server could not be reached. Check its address and connection.'
      ];
      native.invoke = async (command, args) => {
        if (command === 'chat_get_settings') return { ...await original(command, args) as Record<string, unknown>, provider: 'local', localModel: 'saved-local-model' };
        if (command === 'chat_list_local_models') {
          const failure = failures.shift();
          if (failure) throw failure;
          return [{ id: 'refreshed-model' }];
        }
        return original(command, args);
      };
    });
    await category('ai').click();
    const refresh = () => $('button[aria-label="Refresh server models"]');
    for (const message of ['hostname could not be resolved', 'request timed out', 'could not be reached']) {
      await refresh().click();
      await browser.waitUntil(async () => (await $('[data-settings-anchor="chat-model"]').getText()).includes(message));
      await $('button[aria-label="Configure saved-local-model"]').waitForDisplayed();
    }
    await $('button[aria-label="Add a model manually"]').click();
    await $('#manual-local-model').setValue('manual-model');
    await $('button=Add').click();
    await $('dialog[aria-labelledby="local-model-editor-title"]').waitForDisplayed();
    await $('dialog[aria-labelledby="local-model-editor-title"] button[aria-label="Close model editor"]').click();
    await $('button[aria-label="Configure manual-model"]').waitForDisplayed();
    await refresh().click();
    await $('button[aria-label="Configure refreshed-model"]').waitForDisplayed();
    expect(await $('[data-settings-anchor="chat-model"]').getText()).not.toContain('could not be reached');
  });

  it('retires delayed local discovery results after endpoint edits and Settings disposal', async () => {
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      const fixture = { calls: 0, resolve: (_models: unknown) => {}, reject: (_reason: string) => {} };
      native.invoke = async (command, args) => {
        if (command === 'chat_get_settings') return { ...await original(command, args) as Record<string, unknown>, provider: 'local', localModel: 'saved-local-model' };
        if (command === 'chat_list_local_models') {
          fixture.calls++;
          return new Promise((resolve, reject) => { fixture.resolve = resolve; fixture.reject = reject; });
        }
        return original(command, args);
      };
      (window as unknown as { __delayedDiscovery: typeof fixture }).__delayedDiscovery = fixture;
    });
    await category('ai').click();
    const refresh = () => $('button[aria-label="Refresh server models"]');
    const endpoint = () => $('[data-settings-anchor="chat-endpoint"] input');
    const settle = async (failure: boolean) => browser.execute((failure) => {
      const fixture = (window as unknown as { __delayedDiscovery: { resolve: (models: unknown) => void; reject: (reason: string) => void } }).__delayedDiscovery;
      if (failure) fixture.reject('OLD_ENDPOINT_ERROR'); else fixture.resolve([{ id: 'OLD_ENDPOINT_MODEL' }]);
    }, failure);
    for (const failure of [false, true]) {
      await refresh().click();
      await endpoint().setValue(`http://new-endpoint-${failure}.invalid/v1`);
      await refresh().waitForEnabled();
      await settle(failure);
      await browser.execute(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await $('[data-settings-anchor="chat-model"]').getText()).not.toContain('OLD_ENDPOINT');
      expect(await $('body').getText()).not.toContain('Found 1 local model');
    }
    await refresh().click();
    await category('appearance').click();
    await settle(false);
    await category('ai').click();
    await refresh().waitForEnabled();
    expect(await $('[data-settings-anchor="chat-model"]').getText()).not.toContain('OLD_ENDPOINT');
    expect(await browser.execute(() => (window as unknown as { __delayedDiscovery: { calls: number } }).__delayedDiscovery.calls)).toBe(3);
  });

  for (const failure of [false, true]) it(`retires a delayed local capability ${failure ? 'failure' : 'success'} after switching provider`, async () => {
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      const fixture = { settle: async (_failure: boolean) => {} };
      native.invoke = async (command, args) => {
        if (command === 'chat_get_settings') return { ...await original(command, args) as Record<string, unknown>, provider: 'local', localModel: 'saved-local-model' };
        if (command === 'chat_get_model_capabilities') {
          return new Promise((resolve, reject) => {
            fixture.settle = async (failure) => {
              if (failure) reject('Retired local model capability failure');
              else resolve(await original(command, args));
            };
          });
        }
        return original(command, args);
      };
      (window as unknown as { __delayedCapabilities: typeof fixture }).__delayedCapabilities = fixture;
    });
    await category('ai').click();
    await $('button[aria-label="Configure saved-local-model"]').click();
    await $('dialog[aria-labelledby="local-model-editor-title"]').waitForDisplayed();

    // Dismiss the modal before changing its background provider. The capability
    // request is still pending when LocalModelSettings unmounts.
    await browser.keys('Escape');
    const provider = () => $('[data-settings-anchor="chat-provider"] select');
    await provider().selectByAttribute('value', 'openai');
    await expect(provider()).toHaveValue('openai');
    await expect($('dialog[aria-labelledby="local-model-editor-title"]')).not.toExist();
    await expect($('[role="alert"]')).not.toExist();
    await browser.execute(async (failure) => {
      await (window as unknown as { __delayedCapabilities: { settle: (failure: boolean) => Promise<void> } }).__delayedCapabilities.settle(failure);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, failure);
    await expect($('[role="alert"]')).not.toExist();
    await expect($('input[list="openai-chat-models"]')).toBeDisplayed();
  });

  it('retains native sign-in across Settings navigation and supports reopen, cancel and pasted callbacks', async () => {
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__! as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      const original = native.invoke;
      let method = 'apiKey', connected = false;
      let login = { phase: 'idle', browserUrl: null as string | null, manualInput: false, error: null as string | null };
      let finish: ((value: unknown) => void) | null = null;
      let rejectLogin: ((reason: string) => void) | null = null;
      const calls = { starts: 0, cancels: 0, opens: 0, checks: 0, callbacks: 0 };
      const snapshot = () => ({ method, connected, supported: true, login: { ...login } });
      native.invoke = async (command, args) => {
        if (command === 'chat_chatgpt_status') return snapshot();
        if (command === 'chat_chatgpt_login') {
          calls.starts++;
          login = { phase: 'waitingForBrowser', browserUrl: 'https://auth.openai.com/api/accounts/authorize?state=test', manualInput: true, error: null };
          return new Promise((resolve, reject) => { finish = resolve; rejectLogin = reject; });
        }
        if (command === 'chat_chatgpt_cancel') {
          calls.cancels++;
          login = { phase: 'idle', browserUrl: null, manualInput: false, error: null };
          rejectLogin?.('ChatGPT sign-in cancelled'); return;
        }
        if (command === 'chat_chatgpt_open_browser') { calls.opens++; return; }
        if (command === 'chat_chatgpt_manual_input') {
          if ((args as { value: string }).value !== 'http://127.0.0.1:1455/auth/callback?test') throw new Error('callback was not passed');
          calls.callbacks++; method = 'chatgpt'; connected = true;
          login = { phase: 'idle', browserUrl: null, manualInput: false, error: null };
          finish?.(snapshot()); return;
        }
        if (command === 'chat_list_openai_models') { calls.checks++; return [{ id: 'gpt-6-luna' }]; }
        return original(command, args);
      };
      (window as unknown as { __signInCalls: typeof calls }).__signInCalls = calls;
    });
    await category('ai').click();
    await $('button=Continue with ChatGPT').click();
    await $('button=Open sign-in page').waitForDisplayed();
    await category('appearance').click();
    await category('ai').click();
    await $('button=Open sign-in page').waitForDisplayed();
    expect(await browser.execute(() => (window as unknown as { __signInCalls: { cancels: number; starts: number } }).__signInCalls)).toEqual({ starts: 1, cancels: 0, opens: 0, checks: 0, callbacks: 0 });
    await $('button=Open sign-in page').click();
    await $('button=Cancel sign-in').click();
    await $('button=Continue with ChatGPT').waitForDisplayed();
    await $('button=Continue with ChatGPT').click();
    await $('button=Having trouble returning to the app?').waitForDisplayed();
    await $('button=Having trouble returning to the app?').click();
    await $('#chatgpt-callback').setValue('http://127.0.0.1:1455/auth/callback?test');
    await $('button=Complete sign-in').click();
    await browser.waitUntil(async () => (await $('[data-testid="chatgpt-status"]').getText()).includes('Using ChatGPT subscription'));
    await browser.waitUntil(async () => (await $('[data-testid="chatgpt-sign-in"]').getText()).includes('Connection checked.'));
    expect(await $('#chatgpt-callback').isExisting()).toBe(false);
    expect(await browser.execute(() => (window as unknown as { __signInCalls: unknown }).__signInCalls)).toEqual({ starts: 2, cancels: 1, opens: 1, checks: 1, callbacks: 1 });
  });

  it('finds the diff layout setting and retains both choices after reload', async () => {
    await search().setValue('inline diff');
    await $('[data-settings-result="diff-layout"]').click();
    await expectDestination('diff-layout');
    for (const layout of ['side-by-side', 'inline']) {
      await $(`label:has(input[name="edit-diff-layout"][value="${layout}"])`).click();
      await browser.url('/settings');
      await category('appearance').click();
      expect(await $(`input[name="edit-diff-layout"][value="${layout}"]`).isSelected()).toBe(true);
    }
  });

  it('explains manual iOS reopening while keeping desktop restart available', async () => {
    const selection = {
      runningPath: '/e2e', selectedPath: '/next', defaultPath: '/e2e',
      forgottenPath: '/e2e/.forgotten', isDefault: true, noteCount: 2,
      requiresRestart: true, canConfigurePath: true, canPickArbitraryPath: false,
      canRelaunch: false, vaultContainerPath: '/e2e', pathConfigurationNote: null
    };
    await browser.execute((vault) => window.__GNEAUXGHTS_E2E__!.emit('vault-changed', vault), selection);
    await category('vault').click();
    await $('p=Open selected vault on next launch').waitForDisplayed();
    expect(await $('body').getText()).toContain('App Switcher');
    expect(await $('body').getText()).toContain('Home Screen keeps the current vault open');
    expect(await $('button=Restart app').isExisting()).toBe(false);
    const calls = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.map(({ command }) => command));
    expect(calls).not.toContain('prepare_restart');
    expect(calls).not.toContain('plugin:process|restart');

    await browser.execute((vault) => window.__GNEAUXGHTS_E2E__!.emit('vault-changed', vault), {
      ...selection, canRelaunch: true, canPickArbitraryPath: true, vaultContainerPath: null
    });
    await $('button=Restart app').waitForDisplayed();
    expect(await $('p=Restart required').isDisplayed()).toBe(true);
    await browser.execute((vault) => window.__GNEAUXGHTS_E2E__!.emit('vault-changed', vault), {
      ...selection, selectedPath: '/e2e', requiresRestart: false
    });
    expect(await $('p=Open selected vault on next launch').isExisting()).toBe(false);
    expect(await $('p=Restart required').isExisting()).toBe(false);
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
    await shortcut.$('span.rounded-full=Disabled').waitForDisplayed();
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

  it('saves the higher image budget and keeps it selected after a refresh', async () => {
    const contract = JSON.parse(readFileSync('src-tauri/test-fixtures/contracts/app-events.json', 'utf8'));
    const status = contract.events.find((event: { channel: string }) => event.channel === 'semantic-status-changed').payload as SemanticStatus;
    status.imageCapability = 'available';
    status.textReady = true;
    status.migrationState = 'active';
    await browser.execute(async (status) => {
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string) => Promise<Record<string, unknown>> };
      const view = await native.invoke('get_settings_view');
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
        get_settings_view: () => ({ ...view, semanticStatus: status, semanticSettings: status.settings }),
        get_semantic_status: () => status,
        stage_semantic_provider: (args: { usePrevious: boolean }) => { status.nextProvider = args.usePrevious ? 'jina' : 'gemma'; return null; },
        set_semantic_settings: (args: Record<string, unknown>) => {
          status.settings = args.settings as typeof status.settings;
          return status.settings;
        }
      });
    }, status);
    await category('search').click();
    await $('button[aria-label="Refresh semantic search"]').click();
    const detail = await $('#semantic-image-detail');
    await detail.waitForDisplayed();
    expect(await detail.getValue()).toBe('70');
    await detail.selectByAttribute('value', '140');
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(entry =>
      entry.command === 'set_semantic_settings' && (entry.args.settings as { imageTokens: number }).imageTokens === 140)));
    await $('button[aria-label="Refresh semantic search"]').waitForEnabled();
    await $('button[aria-label="Refresh semantic search"]').click();
    expect(await detail.getValue()).toBe('140');
    const rebuilds = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(entry =>
      ['rebuild_semantic_index', 'clear_atlas_cache'].includes(entry.command)));
    expect(rebuilds).toHaveLength(0);
    await $('button=Use previous search next launch').click();
    await $('button=Use Gemma next launch').waitForDisplayed();
    const staged = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.find(entry => entry.command === 'stage_semantic_provider'));
    expect(staged?.args.usePrevious).toBe(true);
  });

  it('sets up a missing runtime and model without leaving Settings', async () => {
    const contract = JSON.parse(readFileSync('src-tauri/test-fixtures/contracts/app-events.json', 'utf8'));
    const status = contract.events.find((event: { channel: string }) => event.channel === 'semantic-status-changed').payload as SemanticStatus;
    status.modelAvailable = false;
    status.model.runtimeBinaryPath = null;
    status.model.error = null;
    status.model.label = 'EmbeddingGemma 2 · LiteRT · text + images';
    await browser.execute(async (initial) => {
      window.__GNEAUXGHTS_E2E__!.restoreIpc();
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string) => Promise<Record<string, unknown>> };
      const view = await native.invoke('get_settings_view');
      let finishDownload: (() => void) | null = null;
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
        get_settings_view: () => ({ ...view, semanticStatus: initial, semanticSettings: initial.settings }),
        get_semantic_status: () => initial,
        download_semantic_embedding_model: async () => {
          initial.setupProgress = {
            phase: 'downloading', fileLabel: 'EmbeddingGemma 2 text and image model',
            fileName: 'embeddinggemma-2-text-vision-440m.litertlm', fileIndex: 2, fileCount: 2,
            downloadedBytes: 193_855_488, totalBytes: 387_710_976, error: null
          };
          await new Promise<void>(resolve => { finishDownload = resolve; });
          initial.setupProgress.phase = 'complete';
          initial.model.runtimeBinaryPath = '/app/semantic/litert-0.18.0/installed/liblitert-lm.dylib';
          return { alreadyPresent: false, path: '/app/model.litertlm' };
        },
        finish_search_setup_fixture: () => { finishDownload?.(); return null; },
        prepare_semantic_model: () => {
          initial.modelAvailable = true;
          initial.model.available = true;
          initial.model.ready = true;
          initial.model.loading = false;
          return null;
        },
        retry_semantic_index: () => null
      });
    }, status);
    await category('search').click();
    await $('button[aria-label="Refresh semantic search"]').click();
    const setup = await $('.semantic-index').$('button=Set up local search');
    await setup.waitForDisplayed();
    await expect($('.semantic-setup-progress')).toHaveText(expect.stringContaining('387.7 MB'));
    await setup.click();
    await $('h3*=Downloading EmbeddingGemma 2').waitForDisplayed();
    await expect($('.semantic-setup-progress')).toHaveText(expect.stringContaining('193.9 MB of 387.7 MB · 50%'));
    expect(await $('progress[aria-label^="Download progress"]').getAttribute('value')).toBe('193855488');
    expect(await $('.semantic-index').$('button=Pause indexing').isExisting()).toBe(false);
    await browser.execute(async () => {
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string) => Promise<unknown> };
      await native.invoke('finish_search_setup_fixture');
    });
    await $('p=Local search is set up. Your notes will now be indexed.').waitForDisplayed();
    await $('h3=Ready to use').waitForDisplayed();
    expect(await browser.getUrl()).toContain('/settings');
    const actions = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations
      .filter(entry => ['download_semantic_embedding_model', 'prepare_semantic_model', 'retry_semantic_index'].includes(entry.command))
      .map(entry => entry.command));
    expect(actions).toEqual(['download_semantic_embedding_model', 'prepare_semantic_model', 'retry_semantic_index']);
  });

  it('keeps semantic controls focused, reveals maintenance from search, and preserves action wiring', async () => {
    await $('label:has(input[name="theme-preference"][value="light"])').click();
    const contract = JSON.parse(readFileSync('src-tauri/test-fixtures/contracts/app-events.json', 'utf8'));
    const status = contract.events.find((event: { channel: string }) => event.channel === 'semantic-status-changed').payload as SemanticStatus;
    status.lastIndexedAtMillis = Date.now() - 60_000;
    await browser.execute(async (status) => {
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string) => Promise<Record<string, unknown>> };
      const view = await native.invoke('get_settings_view');
      Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__!, {
        get_settings_view: () => ({ ...view, semanticStatus: status, semanticSettings: status.settings }),
        get_semantic_status: () => status,
        set_semantic_settings: (args: Record<string, unknown>) => {
          status.settings = args.settings as typeof status.settings;
          return status.settings;
        },
        pause_semantic_indexing: () => { status.indexingPaused = true; status.health = 'paused'; return null; },
        resume_semantic_indexing: () => { status.indexingPaused = false; status.health = 'fresh'; return null; },
        download_semantic_embedding_model: () => ({ alreadyPresent: true, path: '/app/models/jina.gguf' }),
        prepare_semantic_model: () => null,
        retry_semantic_index: () => null,
        clear_atlas_cache: () => null,
        rebuild_semantic_index: () => null
      });
    }, status);
    await category('search').click();
    await $('button[aria-label="Refresh semantic search"]').click();
    await $('h3=Ready to use').waitForDisplayed();
    expect(await $('button=Rebuild semantic index').isDisplayed()).toBe(false);
    expect(await $('dt=Runtime').isDisplayed()).toBe(false);
    await category('appearance').click();
    await $('label:has(input[name="theme-preference"][value="dark"])').click();
    await category('search').click();
    await browser.waitUntil(async () => browser.execute(() => getComputedStyle(document.querySelector('.settings-nav-item.active')!).color === 'oklch(1 0 0)'));
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
    const rebuildConfirmation = await $('[aria-label="Confirm search index rebuild"]');
    await rebuildConfirmation.waitForDisplayed();
    expect(await rebuildConfirmation.getText()).toContain('may take a while');
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(
      entry => entry.command === 'rebuild_semantic_index'
    ))).toHaveLength(0);
    await rebuildConfirmation.$('button=Cancel').click();
    await rebuildConfirmation.waitForExist({ reverse: true });
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(
      entry => entry.command === 'rebuild_semantic_index'
    ))).toHaveLength(0);
    await $('button=Rebuild semantic index').click();
    await rebuildConfirmation.$('button=Confirm rebuild').click();
    await rebuildConfirmation.waitForExist({ reverse: true });
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(
      entry => entry.command === 'rebuild_semantic_index'
    ).length === 1));
    await search().setValue('download model');
    await $('[data-settings-result="download-model"]').click();
    await expectDestination('semantic-download');
    await $('button=Set up local search').click();
    await $('p=Local search is set up. Your notes will now be indexed.').waitForDisplayed();
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
    try {
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await category('search').scrollIntoView();
      await category('search').click();
      await browser.execute(() => {
        document.querySelectorAll<HTMLDetailsElement>('.semantic-disclosure').forEach(details => { details.open = false; });
        document.querySelector<HTMLElement>('.settings-content')!.scrollTop = 0;
      });
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
    await $('label:has(input[name="theme-preference"][value="dark"])').click();
    await browser.waitUntil(async () => browser.execute(() => getComputedStyle(document.querySelector('.settings-nav-item.active')!).color === 'oklch(1 0 0)'));
    await browser.refresh();
    await search().waitForDisplayed();
    expect(await $('input[name="theme-preference"][value="dark"]').isSelected()).toBe(true);
    await $('label:has(input[name="theme-preference"][value="light"])').click();
    await installChatFixture();
    for (const id of ['ai', 'search', 'vault', 'history', 'forgotten', 'shortcuts']) {
      await category(id).click();
      if (id === 'ai') await $('#provider-api-key').waitForDisplayed();
    }
    await search().setValue('privacy');
    await $('[data-settings-result="excluded"]').waitForDisplayed();
    await category('appearance').click();
    const original = await browser.getWindowSize();
    try {
      // Chrome's desktop window has a minimum width. Override the viewport so
      // this exercises a real phone width rather than a clamped 500px window.
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      expect(await browser.execute(() => innerWidth)).toBe(390);
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

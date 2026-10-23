import { browser, $, expect } from '@wdio/globals';

const provider = () => $('[data-settings-anchor="api-keys"] select');
const keyField = () => $('#provider-api-key');
const keySection = () => $('[data-settings-anchor="api-keys"]');
const feedback = () => $('[role="status"]');
const settle = () => browser.execute(() => window.__credentialFixture.settle());

async function expectPending() {
  await expect(provider()).toBeDisabled();
  await expect(keyField()).toBeDisabled();
  await expect($('button[aria-label="Show API key"]')).toBeDisabled();
}

describe('provider credential requests', () => {
  it('keeps deferred saves and removal bound to their provider', async () => {
    await browser.url('/settings');
    await $('[data-settings-section="ai"]').waitForDisplayed();
    await browser.execute(() => {
      const native = window.__TAURI_INTERNALS__;
      const original = native.invoke;
      const fixture = { requests: [], settle: null, keys: { openai: false, local: false } };
      window.__credentialFixture = fixture;
      native.invoke = async (command, args) => {
        if (command === 'chat_get_settings') return { ...await original(command, args), provider: 'openai' };
        if (command === 'chat_get_key_status') return { provider: args.provider, configured: fixture.keys[args.provider] };
        if (command === 'chat_set_api_key') {
          const provider = args.provider, configured = Boolean(args.apiKey);
          fixture.requests.push({ provider, configured });
          return new Promise(resolve => {
            fixture.settle = () => {
              fixture.keys[provider] = configured;
              fixture.settle = null;
              resolve({ provider, configured });
            };
          });
        }
        return original(command, args);
      };
    });
    await $('[data-settings-section="ai"]').click();
    await keyField().waitForDisplayed();

    await keyField().setValue('synthetic-openai-key');
    await $('button=Save key').click();
    await expectPending();
    expect(await browser.execute(() => window.__credentialFixture.requests)).toEqual([
      { provider: 'openai', configured: true }
    ]);
    await settle();
    await expect(provider()).toBeEnabled();
    await expect(keyField()).toHaveValue('');
    await expect(feedback()).toHaveText(expect.stringContaining('OpenAI API key saved securely on this device.'));

    await provider().selectByAttribute('value', 'local');
    await expect(keySection()).toHaveText(expect.stringContaining('No key configured (optional)'));
    await keyField().setValue('synthetic-local-key');
    await $('button=Save key').click();
    await expectPending();
    await settle();
    await expect(provider()).toBeEnabled();
    await expect(feedback()).toHaveText(expect.stringContaining('Compatible server API key saved securely on this device.'));

    await provider().selectByAttribute('value', 'openai');
    await expect(keySection()).toHaveText(expect.stringContaining('Key configured'));
    await $('button=Remove').click();
    await expectPending();
    expect(await browser.execute(() => window.__credentialFixture.requests)).toEqual([
      { provider: 'openai', configured: true },
      { provider: 'local', configured: true },
      { provider: 'openai', configured: false }
    ]);
    await settle();
    await expect(provider()).toBeEnabled();
    await expect(keySection()).toHaveText(expect.stringContaining('No key configured'));
    await expect(feedback()).toHaveText(expect.stringContaining('OpenAI API key removed.'));

    await provider().selectByAttribute('value', 'local');
    await expect(keySection()).toHaveText(expect.stringContaining('Key configured'));
    await expect($('button=Remove')).toBeEnabled();
    expect(await browser.execute(() => window.__credentialFixture.keys)).toEqual({ openai: false, local: true });
  });
});

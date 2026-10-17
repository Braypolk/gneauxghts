import { readPiFixture } from '../../support/browserPi';
import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { clickPaneAction, navigateAppTab } from '../../support/appNavigation';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';

type EditorWindow = typeof window & {
  __GNEAUXGHTS_NATIVE_E2E__: {
    readEditorState(): { editor: { markdown: string; selection: { anchor: number; head: number }; ownsWebviewFocus: boolean } };
    setEditorSelection(anchor: number, head: number): void;
  };
};
const markdown = '[Example](https://example.com)\n\nAfter link';

async function mobile(enabled = true) {
  await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled });
  if (enabled) await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  else await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
}
async function calls(command: string) {
  return browser.execute(name => window.__GNEAUXGHTS_E2E__!.invocations.filter(call => call.command === name), command);
}
async function openChat() {
  if (await browser.execute(() => matchMedia('(any-pointer: coarse)').matches)) {
    await clickPaneAction('Open thought partner');
  } else {
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with thought partner"]').waitForDisplayed();
    await $('button[aria-label="Split with thought partner"]').click();
  }
  await $('textarea[aria-label="Message"]').waitForEnabled();
}
async function prepareLink() {
  await browser.execute((text: string) => {
    window.__GNEAUXGHTS_E2E_COMMANDS__!['plugin:opener|open_url'] = () => null;
    const element = document.querySelector<HTMLElement>('.cm-content')!;
    element.focus(); document.execCommand('selectAll');
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(text.length, text.length);
  }, markdown);
  await $('.cm-gn-link-styled').waitForDisplayed();
}
async function touchLink(cancel = false) {
  const point = await browser.execute(() => {
    const rect = document.querySelector('.cm-gn-link-styled')!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await browser.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await browser.sendCommand('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}

describe('touch editing actions', () => {
  beforeEach(async () => { await resetBrowserWorkspace(); await mobile(); });
  afterEach(async () => { await mobile(false); });

  it('offers Open and Edit on a link tap, opens only explicitly, and preserves authored text', async () => {
    await prepareLink();
    await touchLink();
    await $('[aria-label="External link actions"]').waitForDisplayed();
    expect(await calls('plugin:opener|open_url')).toHaveLength(0);
    await expect($('button=Edit link')).toBeDisplayed();
    await $('button=Open link').click();
    await browser.waitUntil(async () => (await calls('plugin:opener|open_url')).length === 1);
    expect((await calls('plugin:opener|open_url'))[0].args).toMatchObject({ url: 'https://example.com' });
    await expect($('[aria-label="External link actions"]')).not.toExist();
    expect(await browser.execute(() => (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toBe(markdown);
  });

  it('does not open link actions from a cancelled touch', async () => {
    await prepareLink(); await touchLink(true);
    await expect($('[aria-label="External link actions"]')).not.toExist();
    expect(await calls('plugin:opener|open_url')).toHaveLength(0);
    expect(await browser.execute(() => (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toBe(markdown);
  });

  it('edits link Markdown separately and dismisses actions on Escape, outside tap and route exit', async () => {
    await prepareLink();
    await $('.cm-gn-link-styled').click();
    await $('button=Edit link').click();
    await browser.waitUntil(() => browser.execute(() => {
      const state = (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor;
      return state.ownsWebviewFocus && state.selection.anchor === 0 && state.selection.head === 30;
    }));
    await browser.keys('Updated link');
    expect(await browser.execute(() => (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toBe('Updated link\n\nAfter link');
    expect(await calls('plugin:opener|open_url')).toHaveLength(0);
    await prepareLink();
    await $('.cm-gn-link-styled').click(); await browser.keys('Escape');
    await expect($('[aria-label="External link actions"]')).not.toExist();
    await $('.cm-gn-link-styled').click(); await $('[data-testid="note-title"]').click();
    await expect($('[aria-label="External link actions"]')).not.toExist();
    await $('.cm-gn-link-styled').click(); await navigateAppTab('Settings');
    await expect($('[aria-label="External link actions"]')).not.toExist();
  });

  it('preserves desktop modifier opening and plain-click editing', async () => {
    await mobile(false); await prepareLink();
    await browser.execute(() => document.querySelector('.cm-gn-link-styled')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })));
    await browser.waitUntil(async () => (await calls('plugin:opener|open_url')).length === 1);
    await $('.cm-gn-link-styled').click();
    await expect($('[aria-label="External link actions"]')).not.toExist();
    await browser.keys('Desktop edit');
    expect(await browser.execute(() => (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toBe('Desktop edit\n\nAfter link');
  });

  it('closes link actions when keyboard activation collapses their retained pane', async () => {
    await prepareLink();
    await clickPaneAction('Split pane');
    await $('#pane-command-current').click();
    await waitForWorkspaceAnimationSettled();
    await $('[data-testid="workspace-pane"]:not([data-pane-collapsed]) .cm-gn-link-styled').click();
    await $('[aria-label="External link actions"]').waitForDisplayed();
    // Focus and activate the rail without a pointerdown dismissing the menu.
    await browser.execute(() => document.querySelector<HTMLElement>('.pane-rail')!.focus());
    await browser.keys(['Shift', 'Enter', '\uE000']);
    await waitForWorkspaceAnimationSettled();
    await expect($('[aria-label="External link actions"]')).not.toExist();
    await expect($('[data-pane-collapsed] [data-pane-frame]')).toHaveAttribute('inert');
    expect(await calls('plugin:opener|open_url')).toHaveLength(0);
    expect(await browser.execute(() => (window as EditorWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown)).toBe(markdown);
  });

  it('inserts Shift+Return newlines on touch, then explicitly sends the multiline draft once', async () => {
    await openChat();
    const composer = await $('textarea[aria-label="Message"]');
    await composer.setValue('First line'); await browser.keys('Enter'); await browser.keys('Second line');
    await browser.keys(['Shift', 'Enter', '\uE000']); await browser.keys('Third line');
    await expect(composer).toHaveValue('First line\nSecond line\nThird line');
    expect(await readPiFixture()).toHaveLength(0);
    await $('button[aria-label="Send message"]').click();
    await browser.waitUntil(async () => (await readPiFixture())[0]?.messages.some(message => message.role === 'user') ?? false);
    expect((await readPiFixture())[0].messages.find(message => message.role === 'user')).toMatchObject({ content: 'First line\nSecond line\nThird line' });
    await expect(composer).toHaveValue('');
  });

  it('does not intercept composing Return, including the Safari legacy IME signal', async () => {
    await mobile(false); await openChat();
    const composer = await $('textarea[aria-label="Message"]'); await composer.setValue('Composing draft');
    for (const touch of [false, true]) {
      await mobile(touch);
      for (const signal of [{ isComposing: true }, { keyCode: 229 }]) {
        expect(await browser.execute((signal: KeyboardEventInit) => document.querySelector('textarea[aria-label="Message"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...signal })), signal)).toBe(true);
      }
    }
    expect(await readPiFixture()).toHaveLength(0);
    await expect(composer).toHaveValue('Composing draft');
  });

  it('retains desktop Enter to send and Shift+Enter for multiline editing', async () => {
    await mobile(false); await openChat();
    const composer = await $('textarea[aria-label="Message"]');
    await composer.setValue('Desktop'); await browser.keys(['Shift', 'Enter', '\uE000']); await browser.keys('second line');
    expect(await readPiFixture()).toHaveLength(0);
    await expect(composer).toHaveValue('Desktop\nsecond line');
    await browser.keys('Enter');
    await browser.waitUntil(async () => (await readPiFixture())[0]?.messages.some(message => message.role === 'user') ?? false);
    expect((await readPiFixture())[0].messages.find(message => message.role === 'user')).toMatchObject({ content: 'Desktop\nsecond line' });
  });
});

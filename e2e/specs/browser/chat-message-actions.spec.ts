import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, selectPiConversation } from '../../support/browserPi';

declare global {
  interface Window {
    __chatCopies?: string[];
    __chatCopyFails?: boolean;
    __restoreChatClipboard?: () => void;
  }
}

describe('chat message copy and time', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace(); await openBrowserPiPane();
    await browser.execute(() => {
      const descriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText');
      window.__chatCopies = [];
      window.__chatCopyFails = false;
      window.__restoreChatClipboard = () => {
        if (descriptor) Object.defineProperty(navigator.clipboard, 'writeText', descriptor);
        else Reflect.deleteProperty(navigator.clipboard, 'writeText');
        delete window.__chatCopies; delete window.__chatCopyFails; delete window.__restoreChatClipboard;
      };
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => {
        if (window.__chatCopyFails) throw new Error('Clipboard unavailable');
        window.__chatCopies!.push(text);
      } });
    });
  });
  afterEach(async () => {
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await browser.execute(() => window.__restoreChatClipboard?.());
  });

  it('reveals actions on hover and keyboard focus, copies full Markdown, and retains the finish time on reopen', async () => {
    const question = 'Copy my **whole** question.\nSecond line.';
    const answer = `## Answer\n\n${'A useful answer. '.repeat(35)}\n\n\`\`\`ts\nconst value = 42;\n\`\`\``;
    const started = await browser.execute(() => Date.now());
    await browser.execute((answer: string) => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.setNextPiResponse(answer, 'Separate reasoning. '.repeat(15)).then(done);
    }), answer);
    await browser.execute(question => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
      input.value = question; input.dispatchEvent(new Event('input', { bubbles: true }));
    }, question);
    await $('[data-testid="pi-send"]').click();
    const streaming = await $('[data-testid="pi-assistant-message"][data-streaming="true"]');
    await streaming.waitForExist();
    await expect(streaming.$('[data-testid="pi-message-actions"]')).not.toBeExisting();
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true });
    const assistant = await $('[data-testid="pi-assistant-message"]');
    const user = await $('[data-testid="pi-user-message"]');
    const opacity = (role: string) => browser.execute(role => getComputedStyle(document.querySelector(`[data-testid="pi-${role}-message"] footer`)!).opacity, role);
    await $('textarea[aria-label="Message"]').moveTo();
    expect(await opacity('assistant')).toBe('0');
    expect(await opacity('user')).toBe('0');
    const height = await assistant.getSize('height');
    await assistant.moveTo();
    expect(await opacity('assistant')).toBe('1');
    expect(await assistant.getSize('height')).toBe(height);
    const time = await assistant.$('time');
    const finishedAt = await time.getAttribute('datetime');
    if (!finishedAt) throw new Error('Message has no recorded time');
    expect(Date.parse(finishedAt)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(finishedAt)).toBeLessThanOrEqual(await browser.execute(() => Date.now()));
    await expect(time).toHaveAttribute('title', expect.stringContaining('Finished'));
    await assistant.$('button[aria-label="Copy message"]').click();
    await expect(assistant.$('[role="status"]')).toHaveText('Message copied');
    expect(await browser.execute(() => window.__chatCopies)).toEqual([answer]);

    await user.scrollIntoView(); await user.moveTo();
    await expect(user.$('time')).toHaveAttribute('title', expect.stringContaining('Sent'));
    await user.$('button[aria-label="Copy message"]').click();
    expect(await browser.execute(() => window.__chatCopies)).toEqual([answer, question]);
    await $('textarea[aria-label="Message"]').click();
    await $('textarea[aria-label="Message"]').moveTo();
    expect(await opacity('user')).toBe('0');
    await browser.execute(() => document.querySelector<HTMLButtonElement>('[data-testid="pi-user-message"] button[aria-label="Copy message"]')!.focus());
    expect(await opacity('user')).toBe('1');
    await browser.keys('Enter');
    await browser.waitUntil(async () => (await browser.execute(() => window.__chatCopies!.length)) === 3);
    await browser.saveScreenshot('/private/tmp/gneauxghts-message-actions.png');

    const title = 'Message action fixture';
    await $('input[aria-label="Conversation title"]').setValue(title);
    await $('textarea[aria-label="Message"]').click();
    await $('button[aria-label="Conversations"]').click();
    await $('button[data-new-conversation]').click();
    await selectPiConversation(title);
    expect(await $('[data-testid="pi-assistant-message"] time').getAttribute('datetime')).toBe(finishedAt);
  });

  it('shows actions on touch and reports clipboard failure without claiming success', async () => {
    await $('textarea[aria-label="Message"]').setValue('Keep my message');
    await $('[data-testid="pi-send"]').click();
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true });
    await browser.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
    const user = await $('[data-testid="pi-user-message"]');
    await user.scrollIntoView();
    expect(await browser.execute(() => getComputedStyle(document.querySelector('[data-testid="pi-user-message"] footer')!).opacity)).toBe('1');
    const size = await user.$('button[aria-label="Copy message"]').getSize();
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
    await browser.execute(() => { window.__chatCopyFails = true; });
    await user.$('button[aria-label="Copy message"]').click();
    await expect(user.$('[role="status"]')).toHaveText('Could not copy. Try again.');
    expect(await browser.execute(() => window.__chatCopies)).toEqual([]);
    await browser.execute(() => { window.__chatCopyFails = false; });
    await user.$('button[aria-label="Copy message"]').click();
    await expect(user.$('[role="status"]')).toHaveText('Message copied');
    expect(await browser.execute(() => window.__chatCopies)).toEqual(['Keep my message']);
  });
});

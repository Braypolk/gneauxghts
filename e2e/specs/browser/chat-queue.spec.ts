import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { openBrowserPiPane, readPiFixture } from '../../support/browserPi';

describe('Pi queued-message presentation', () => {
  beforeEach(async () => { await resetBrowserWorkspace(); await openBrowserPiPane(); });

  async function send(text: string) {
    await $('textarea[aria-label="Message"]').setValue(text);
    await $('[data-testid="pi-send"]').click();
  }

  it('counts real inbox submissions, preserves the remaining item on withdrawal, and clears on Stop', async () => {
    await browser.execute(() => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.holdNextPiResponse().then(done);
    }));
    await send('Hold this response');
    await $('[data-testid="pi-stop"]').waitForEnabled();
    await send('Same follow-up');
    const queue = await $('[data-testid="pi-queue"]');
    const trigger = await queue.$('[data-slot="trace-collapsible-trigger"]');
    await expect(trigger).toHaveText('1 queued message');
    await send('Same follow-up');
    await expect(trigger).toHaveText('2 queued messages');
    const items = await queue.$$('li');
    expect(items.length).toBe(2);
    const retainedId = await items[1].getAttribute('data-submission-id');
    if (!retainedId) throw new Error('Queued submission has no Pi identity');
    await trigger.click();
    await expect(queue.$('ul')).not.toBeDisplayed();
    await browser.keys('Enter');
    await expect(queue.$('ul')).toBeDisplayed();
    await items[0].$('button[aria-label="Withdraw queued message"]').click();
    await expect(trigger).toHaveText('1 queued message');
    await expect(queue.$('li')).toHaveAttribute('data-submission-id', retainedId);
    await expect(queue.$('li')).toHaveText('Same follow-up');
    await browser.saveScreenshot('/private/tmp/gneauxghts-pi-queue.png');
    await $('[data-testid="pi-stop"]').click();
    await queue.waitForExist({ reverse: true });
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true });
    expect((await readPiFixture()).flatMap(item => item.messages).filter(message => message.role === 'user').map(message => message.content)).toEqual(['Hold this response']);
  });

  it('lets Pi dispatch a queued prompt after the active response completes', async () => {
    await browser.execute(() => new Promise<void>((done) => {
      void window.__GNEAUXGHTS_E2E__!.setNextPiResponse('A response long enough to queue a follow-up. '.repeat(50)).then(done);
    }));
    await send('First question');
    await $('[data-testid="pi-stop"]').waitForEnabled();
    await send('Queued question');
    await expect($('[data-testid="pi-queue"]')).toHaveText(expect.stringContaining('Queued question'));
    await $('[data-testid="pi-queue"]').waitForExist({ reverse: true, timeout: 15000 });
    await $('[data-testid="pi-stop"]').waitForExist({ reverse: true, timeout: 15000 });
    const users = (await readPiFixture()).flatMap(item => item.messages).filter(message => message.role === 'user');
    expect(users.map(message => message.content)).toEqual(['First question', 'Queued question']);
    await expect($('[aria-label="Conversation messages"]')).toHaveText(expect.stringContaining('Fixture ordinary answer.'));
  });
});

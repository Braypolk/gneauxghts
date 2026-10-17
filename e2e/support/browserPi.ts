import { browser, $ } from '@wdio/globals';

export async function seedPiHistory(title = 'Populated motion fixture', count = 40) {
  return browser.executeAsync((title: string, count: number, done: (result: { id?: string; error?: string }) => void) => {
    void window.__GNEAUXGHTS_E2E__!.seedPiChat({ title, count }).then(id => done({ id }), error => done({ error: String(error) }));
  }, title, count).then(result => { if (result.error) throw new Error(result.error); return result.id!; });
}

export async function openBrowserPiPane() {
  await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
  await $('button[aria-label="Split with thought partner"]').click();
  await $('textarea[aria-label="Message"]').waitForEnabled();
}

export async function selectPiConversation(title: string) {
  await $('button[aria-label="Conversations"]').click();
  await $(`[role="menuitem"]*=${title}`).click();
  await browser.waitUntil(async () => (await $('input[aria-label="Conversation title"]').getValue()) === title);
}

export async function readPiFixture() {
  return browser.executeAsync((done: (result: { items?: Awaited<ReturnType<NonNullable<Window['__GNEAUXGHTS_E2E__']>['readPiChat']>>; error?: string }) => void) => {
    void window.__GNEAUXGHTS_E2E__!.readPiChat().then(items => done({ items }), error => done({ error: String(error) }));
  }).then(result => { if (result.error) throw new Error(result.error); return result.items!; });
}

import { browser, expect, $ } from '@wdio/globals';
import { samplePaneMotion } from '../../support/paneMotion';
import { configurePi, assertDisposable, startPiProviderFixture } from '../../support/piChatAcceptance';
import { invokeNative } from '../../support/liveNative';
import type { PiChat, PI_CONTEXT } from '../../../src/lib/features/chat/pi/runtime';

type Host = Window & { __GNEAUXGHTS_NATIVE_E2E__: { piChat(): Promise<PiChat>; piContext(): Promise<typeof PI_CONTEXT> } };

describe('native ordinary Pi chat motion', () => {
  it('retains the mounted editor while opening and closing populated Pi history', async () => {
    await assertDisposable();
    const fixture = await startPiProviderFixture();
    try {
      await configurePi(fixture.endpoint, fixture.model);
      await browser.execute(() => new Promise<string | null>((done) => {
        void (async () => {
          const bridge = (window as unknown as Host).__GNEAUXGHTS_NATIVE_E2E__, chat = await bridge.piChat(), context = await bridge.piContext();
          const conversation = await chat.createConversation({ title: 'Populated motion fixture' });
          for (let index = 0; index < 40; index++)
            await conversation.submit({ type: 'write', entry: { kind: 'acceptance.motion', model: [{ role: 'user', content: `Past ${index}: ${'Synthetic retained history. '.repeat(40)}`, timestamp: index }] } }, context);
        })().then(() => done(null), error => done(String(error)));
      })).then(error => { expect(error).toBe(null); });
      await invokeNative('plugin:window|show', { label: 'main' });
      await invokeNative('plugin:window|set_focus', { label: 'main' });
      for (let round = 0; round < 2; round++) {
        await browser.waitUntil(async () => browser.execute(() => document.hasFocus() && document.visibilityState === 'visible'));
        const opening = await samplePaneMotion('open-chat');
        expect(opening.frames.every(frame => frame.focused && frame.visible)).toBe(true);
        expect(opening.frames.every(frame => frame.panes[0].sameEditor)).toBe(true);
        await $('button[aria-label="Conversations"]').click();
        await $('button[role="menuitem"]*=Populated motion fixture').click();
        await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('[data-testid="pi-user-message"]').length === 40));
        expect(await browser.execute(() => { const log = document.querySelector<HTMLElement>('[role="log"]')!; return log.scrollHeight - log.clientHeight - log.scrollTop; })).toBeLessThanOrEqual(2);
        const closing = await samplePaneMotion('close-right');
        expect(closing.frames.every(frame => frame.focused && frame.visible)).toBe(true);
        expect(closing.frames.every(frame => frame.panes[0].sameEditor)).toBe(true);
      }
    } finally { await fixture.close(); }
  });
});

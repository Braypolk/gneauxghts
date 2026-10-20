import { browser, $ } from '@wdio/globals';
import { writeFileSync } from 'node:fs';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

// Node's built-in WebSocket talks directly to this test Chrome's CDP endpoint;
// profiling adds no dependency or instrumentation to the production editor.
async function profileClient() {
  const address = (browser.capabilities as { 'goog:chromeOptions'?: { debuggerAddress?: string } })['goog:chromeOptions']?.debuggerAddress;
  if (!address) throw new Error('Chrome debugger address missing');
  const targets = await (await fetch(`http://${address}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl: string }[];
  const target = targets.find(target => target.type === 'page' && target.url.includes('127.0.0.1:'));
  if (!target) throw new Error('App profiling target missing');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('CDP connection timed out')), 15_000);
    socket.addEventListener('open', () => { clearTimeout(deadline); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(deadline); reject(new Error('CDP connection failed')); }, { once: true });
  });
  let id = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  return { send(method: string, params: object = {}): Promise<any> {
    const next = ++id;
    return new Promise((resolve, reject) => { pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
  }, detach() { socket.close(); } };
}

describe('giant quote CPU profile', () => {
  for (const panes of [1, 2]) it(`profiles 50000 lines in ${panes} panes`, async function () {
    if (!process.env.MARKDOWN_PROFILE_PREFIX) this.skip();
    this.timeout(600_000);
    await browser.setTimeout({ script: 600_000 });
    await resetBrowserWorkspace();
    if (panes === 2) {
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
      await $('button[aria-label="Split with current location"]').waitForExist();
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click());
      await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('[data-testid="note-editor"][aria-busy="false"]').length === 2));
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-pane-motion]')));
    }
    const prepared = await browser.executeAsync(async (panes: number, done: (result: any) => void) => {
      try {
        const path = '/src/lib/e2e/markdownFullAppHarness.ts';
        const harness = await import(/* @vite-ignore */ path);
        done(await harness.prepareFullAppMarkdown('quote', 50_000, panes));
      } catch (error) { done({ error: String(error) }); }
    }, panes);
    if (prepared.error) throw new Error(prepared.error);
    const client = await profileClient();
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 1000 });
    await client.send('Profiler.start');
    try {
      const result = await browser.executeAsync(async (done: (result: any) => void) => {
        try {
          const path = '/src/lib/e2e/markdownFullAppHarness.ts';
          const harness = await import(/* @vite-ignore */ path);
          done(await harness.measureFullAppMarkdown('document', 15));
        } catch (error) { done({ error: String(error) }); }
      });
      if (result.error) throw new Error(result.error);
      writeFileSync(`${process.env.MARKDOWN_PROFILE_PREFIX}-${panes}-measurements.json`, JSON.stringify({ environment: prepared, profiledEdits: 15, reportedSamples: 10, ...result }, null, 2) + '\n');
    } finally {
      const { profile } = await client.send('Profiler.stop');
      writeFileSync(`${process.env.MARKDOWN_PROFILE_PREFIX}-${panes}.cpuprofile`, JSON.stringify(profile));
      await client.detach();
    }
  });
});

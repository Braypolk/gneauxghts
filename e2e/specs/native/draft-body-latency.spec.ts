import { browser, $, expect } from '@wdio/globals';
import { writeFileSync } from 'node:fs';

describe('native immutable draft body latency', function () {
  const rows: unknown[] = [];
  before(async function () {
    if (!process.env.DRAFT_BODY_NATIVE_OUTPUT) this.skip();
    if (process.env.GNEAUXGHTS_E2E_FOREGROUND !== '1') throw new Error('Native input benchmark requires the foreground lane');
    await $('[data-testid="note-editor"][aria-busy="false"]').waitForExist({ timeout: 30_000 });
    await browser.setTimeout({ script: 180_000 });
  });
  afterEach(function () { if (this.currentTest?.err) this.currentTest.parent!.bail(true); });
  const cases = [
    { kind: 'multiline2m', panes: 1, sourceIndex: 0 },
    { kind: 'multiline500k', panes: 2, sourceIndex: 0 },
    { kind: 'multiline2m', panes: 2, sourceIndex: 0 },
    { kind: 'multiline2m', panes: 2, sourceIndex: 1 },
    { kind: 'fence2m', panes: 2, sourceIndex: 0 },
    { kind: 'quote', panes: 2, sourceIndex: 0 },
  ] as const;
  for (const fixture of cases) it(`${fixture.kind}, ${fixture.panes} panes, input pane ${fixture.sourceIndex + 1}`, async function () {
    this.timeout(240_000);
    if (fixture.panes === 2 && await browser.execute(() => document.querySelectorAll('[data-testid="note-editor"] .cm-editor').length) === 1) {
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
      await $('button[aria-label="Split with current location"]').waitForExist();
      await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Split with current location"]')!.click());
      await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('[data-testid="note-editor"][aria-busy="false"]').length === 2));
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-pane-motion]')));
    }
    const setup = await browser.execute((fixture: typeof cases[number]) => new Promise<any>((done, reject) => {
      void (async () => {
        try {
          const path = '/src/lib/e2e/draftBodyLatencyHarness.ts';
          const h = await import(/* @vite-ignore */ path);
          const environment = await h.prepare(fixture.kind, fixture.panes, fixture.sourceIndex);
          h.armNative();
          done({ environment });
        }
        catch (error) {
          done({ measurementFailure: String(error) });
        }
      })().catch(reject);
    }), fixture);
    expect(setup.measurementFailure).toBeUndefined();
    for (let i = 0; i < 25; i++) {
      const sample = await browser.execute(() => new Promise<any>((done, reject) => {
        void (async () => {
          try {
            const path = '/src/lib/e2e/draftBodyLatencyHarness.ts';
            const h = await import(/* @vite-ignore */ path);
            h.typeCharacter();
            done({ count: await h.waitNative() });
          }
          catch (error) {
            done({ measurementFailure: String(error) });
          }
        })().catch(reject);
      }));
      expect(sample.measurementFailure).toBeUndefined();
      expect(sample.count).toBe(i + 1);
    }
    const result = await browser.execute(() => new Promise<any>((done, reject) => {
      void (async () => {
        try {
          const path = '/src/lib/e2e/draftBodyLatencyHarness.ts';
          const h = await import(/* @vite-ignore */ path);
          const native = h.finishNative();
          const queued = await h.queuedTyping(80);
          done({ native, queued });
        }
        catch (error) {
          done({ measurementFailure: String(error) });
        }
      })().catch(reject);
    }));
    expect(result.measurementFailure).toBeUndefined();
    rows.push({ ...fixture, ...setup, ...result });
    writeFileSync(process.env.DRAFT_BODY_NATIVE_OUTPUT!, JSON.stringify({ variant: process.env.DRAFT_BODY_VARIANT,
      description: 'Native macOS WebKit, production app and real IPC in a disposable vault; DOM insertText input awaits frames; separate open-loop dispatch at 12.5 edits/s. RAF proxies exclude OS input arrival and compositor scanout.', rows }, null, 2) + '\n');
  });
});

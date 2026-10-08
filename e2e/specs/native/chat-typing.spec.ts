import assert from 'node:assert/strict';
import { browser, $ } from '@wdio/globals';

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync((cmd, input, done: (result: { value?: unknown; error?: string }) => void) => {
    const native = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } };
    void native.__TAURI_INTERNALS__.invoke(cmd, input).then(value => done({ value }), error => done({ error: String(error) }));
  }, command, args);
  if (result.error) throw new Error(result.error);
  return result.value as T;
}

const slowSearch = process.env.GNEAUXGHTS_E2E_CHAT_CONTEXT_DELAY_MS === '2000' ? describe : describe.skip;

slowSearch('native chat typing with slow related-note suggestions', function () {
  this.timeout(60_000);
  it('paints typed text promptly and runs only the latest queued search', async () => {
    assert.equal(process.env.GNEAUXGHTS_E2E_CHAT_CONTEXT_DELAY_MS, '2000', 'Run with the bounded native search delay');
    await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
    const { atlasVisibility: _visibility, ...defaults } = await invoke<Record<string, unknown>>('chat_get_settings');
    await invoke('chat_set_defaults', { defaults: { ...defaults, provider: 'local', model: 'typing-fixture', localModel: 'typing-fixture',
      localBaseUrl: 'http://127.0.0.1:9/v1', defaultAccess: 'full', webAccess: 'off' } });
    await invoke('chat_set_local_model_capabilities', { model: 'typing-fixture', capabilities: { tools: false, images: false, audio: false, video: false, reasoningEffort: 'medium' } });
    const semantic = await invoke<Record<string, unknown>>('get_semantic_settings');
    await invoke('set_semantic_settings', { settings: { ...semantic, semanticSearchEnabled: false } });
    const note = await invoke<{ path: string }>('save_note', { title: 'Typing project', markdown: 'Typing project alphabet abcdef notes for a disposable responsiveness check.', currentPath: null });
    assert(note.path.includes('gneauxghts-native-e2e-'));
    await invoke('e2e_flush_vault_watcher_path', { path: note.path });
    await browser.refresh();
    const open = await $('button[aria-label="Open thought partner in this pane"]');
    await open.waitForExist();
    await browser.execute((el: HTMLElement) => el.click(), open);
    const composer = await $('[data-notepad-command-bar] textarea');
    await composer.waitForEnabled();
    await invoke('plugin:window|show', { label: 'main' });
    await invoke('plugin:window|set_focus', { label: 'main' });
    await browser.waitUntil(() => browser.execute(() => document.visibilityState === 'visible' && document.hasFocus()));
    const samples = await browser.executeAsync((done: (value: { paints: number[]; maxInFlight: number; queries: string[]; finalText: string; error?: string }) => void) => {
      const events = (window as unknown as { __TAURI__: { event: { listen: (name: string, callback: (event: { payload: { phase: string; query?: string } }) => void) => Promise<() => void> } } }).__TAURI__.event;
      const queries: string[] = [];
      const paints: number[] = [];
      let inFlight = 0;
      let maxInFlight = 0;
      let finished = false;
      let unlisten: (() => void) | undefined;
      const pending = new Set<() => void>();
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-notepad-command-bar] textarea');
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(overallDeadline);
        for (const cancel of [...pending]) cancel();
        unlisten?.();
        unlisten = undefined;
        done({ paints, maxInFlight, queries, finalText: textarea?.value ?? '', ...(error ? { error } : {}) });
      };
      const overallDeadline = setTimeout(() => finish('Chat typing measurement exceeded its wall deadline'), 20_000);
      const pause = (ms: number) => new Promise<void>(resolve => {
        const cancel = () => { clearTimeout(timer); pending.delete(cancel); resolve(); };
        const timer = setTimeout(cancel, ms);
        pending.add(cancel);
      });
      const twoFrames = () => new Promise<boolean>(resolve => {
        let settled = false;
        let frameId = 0;
        const complete = (painted: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          cancelAnimationFrame(frameId);
          pending.delete(cancel);
          resolve(painted);
        };
        const cancel = () => complete(false);
        const deadline = setTimeout(cancel, 5000);
        pending.add(cancel);
        frameId = requestAnimationFrame(() => {
          if (finished || settled) return;
          frameId = requestAnimationFrame(() => complete(!finished));
        });
      });
      void (async () => {
        try {
          const release = await events.listen('e2e://context-search', ({ payload }) => {
            if (finished) return;
            if (payload.phase === 'started') {
              queries.push(payload.query!);
              maxInFlight = Math.max(maxInFlight, ++inFlight);
            } else if (payload.phase === 'finished') inFlight -= 1;
          });
          if (finished) { release(); return; }
          unlisten = release;
          if (!textarea) throw new Error('Missing chat composer');
          textarea.focus();
          let text = 'typing project ';
          for (const char of 'abcdef') {
            if (finished) return;
            text += char;
            const started = performance.now();
            textarea.value = text;
            textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
            if (!await twoFrames()) {
              finish('Chat typing paint exceeded its wall deadline');
              return;
            }
            if (finished) return;
            paints.push(performance.now() - started);
            await pause(450); // Each keystroke outlasts the 350ms search debounce.
          }
          if (finished) return;
          const deadline = performance.now() + 10_000;
          while (!finished && (inFlight > 0 || queries.at(-1) !== text) && performance.now() < deadline) await pause(50);
          if (finished) return;
          if (inFlight > 0) throw new Error('Suggestion requests did not settle');
          finish();
        } catch (error) { finish(String(error)); }
      })();
    });
    console.log('CHAT_TYPING_NATIVE', JSON.stringify(samples));
    assert.equal(samples.error, undefined);
    assert.equal(samples.finalText, 'typing project abcdef');
    assert.equal(samples.maxInFlight, 1, 'Slow searches must not accumulate');
    assert(samples.queries.length >= 2 && samples.queries.length < 6, 'Skip superseded intermediate queries');
    assert.equal(samples.queries.at(-1), samples.finalText, 'Latest draft must eventually be searched');
    assert(samples.paints.every(ms => ms < 250), `Input-to-paint delays: ${samples.paints}`);
  });
});

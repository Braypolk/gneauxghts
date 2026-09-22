import { browser, expect, $ } from '@wdio/globals';
import { expectContinuousMotion, samplePaneMotion } from '../../support/paneMotion';

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result: { ok: boolean; value?: unknown; error?: string } = await browser.executeAsync((cmd, input, done) => {
    const native = window as typeof window & {
      __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> }
    };
    void native.__TAURI_INTERNALS__.invoke(cmd, input).then(
      value => done({ ok: true, value }), error => done({ ok: false, error: JSON.stringify(error) })
    );
  }, command, args);
  if (!result.ok) throw new Error(result.error);
  return result.value as T;
}

describe('native pane motion', () => {
  it('keeps measured pane motion continuous in the visible WebKit workspace', async () => {
    await browser.switchToWindow('main');
    await $('[data-testid="note-editor"] .cm-content').waitForExist({ timeout: 30_000 });
    const note = await invoke<{ noteId: string }>('save_note', {
      title: 'Pane motion fixture', currentPath: null,
      markdown: Array.from({ length: 80 }, (_, i) => `Alpha line ${i + 1}: browser regression fixture`).join('\n\n')
    });
    await invoke('mark_note_opened', { noteId: note.noteId });
    await browser.refresh();
    await $('[data-testid="note-editor"] .cm-content').waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await $('[data-testid="note-title"]').getValue()) === 'Pane motion fixture', { timeout: 30_000 });
    // The embedded macOS driver takes physical pixels on Retina displays.
    const scale = await browser.execute(() => devicePixelRatio);
    await browser.setWindowRect(60, 80, 1440 * scale, 900 * scale);
    await browser.waitUntil(async () => browser.execute(() => innerWidth >= 1000 && innerHeight >= 560));
    await invoke('plugin:window|show', { label: 'main' });
    await invoke('plugin:window|set_focus', { label: 'main' });
    await browser.waitUntil(async () => browser.execute(() => document.visibilityState === 'visible' && document.hasFocus()));
    await browser.pause(500);
    for (const side of ['right', 'left'] as const) {
      const opening = await samplePaneMotion('open');
      expect(opening.frames.at(-1)!.panes).toHaveLength(2);
      expectContinuousMotion(opening);
      await $('#pane-command-current').waitForExist();
      await browser.execute(() => document.querySelector<HTMLElement>('#pane-command-current')!.click());
      await $('[data-pane-command="split"]').waitForExist({ reverse: true });
      const closing = await samplePaneMotion(`close-${side}`);
      expectContinuousMotion(closing);
      expect(closing.frames.at(-1)!.panes).toHaveLength(1);
      console.log('PANE_NATIVE_MOTION', JSON.stringify({
        side, openingFocused: opening.frames.every(frame => frame.focused && frame.visible), closingFocused: closing.frames.every(frame => frame.focused && frame.visible), openingMaxGap: opening.maxGap, closingMaxGap: closing.maxGap,
        opening: opening.frames.map(frame => ({ time: frame.time - opening.before.time, widths: frame.panes.map(pane => pane.width) })),
        closing: closing.frames.map(frame => ({ time: frame.time - closing.before.time, widths: frame.panes.map(pane => pane.width) }))
      }));
    }
    console.log('PANE_NATIVE_FOCUS', JSON.stringify({nativeFocused: await invoke('plugin:window|is_focused', { label: 'main' }), dom: await browser.execute(() => ({ visible: document.visibilityState, focused: document.hasFocus(), activeIsEditor: document.activeElement?.classList.contains('cm-content') ?? false }))}));
    expect(await browser.execute(() => document.visibilityState === 'visible' && document.hasFocus())).toBe(true);
  });
});

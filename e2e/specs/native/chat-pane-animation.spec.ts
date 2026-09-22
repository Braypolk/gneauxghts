import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chatHistoryFixture } from '../../support/chatHistoryFixture';
import { browser, expect, $ } from '@wdio/globals';
import { samplePaneMotion } from '../../support/paneMotion';

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

describe('native populated chat motion', () => {
  it('loads restored history without blocking the split animation', async () => {
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
    const vault = await invoke<{runningPath: string}>('get_vault_info');
    const root = realpathSync(join(vault.runningPath, '..', '..'));
    if (dirname(root) !== realpathSync(tmpdir()) || !basename(root).startsWith('gneauxghts-native-e2e-')) {
      throw new Error('Chat fixture requires the disposable native E2E vault');
    }
    const conversation = await invoke<{id: string}>('chat_create_conversation', {request: {title: 'Populated motion fixture'}});
    execFileSync('python3', ['-c', `
import json, sqlite3, sys
fixture = json.load(sys.stdin)
with sqlite3.connect(fixture['database']) as db:
    for message in fixture['messages']:
        db.execute('INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', (message['id'], fixture['id'], message['ordinal'], message['role'], 'complete', message['content'], message['createdAtMillis']))
`], {input: JSON.stringify({database: join(vault.runningPath, '.gneauxghts', 'ai.sqlite3'), id: conversation.id, messages: chatHistoryFixture().messages})});
    for (let round = 0; round < 2; round++) {
      await invoke('plugin:window|set_focus', { label: 'main' });
      await browser.waitUntil(async () => browser.execute(() => document.hasFocus()));
      const opening = await samplePaneMotion('open-chat');
      console.log('CHAT_NATIVE_MOTION', JSON.stringify({ round, opening }));
      expect(opening.frames.some(frame => frame.messages > 0 && frame.messages < 100)).toBe(true);
      // A severe UI-thread stall should fail this fixture, without promising 60fps
      // from a debug build. The original native conversation load exceeded 330ms.
      expect(opening.maxGap).toBeLessThan(150);
      await browser.waitUntil(async () => browser.execute(() =>
        document.querySelectorAll('[data-chat-message-id]').length === 100 &&
        document.querySelector('[role="log"]')?.getAttribute('aria-busy') === 'false'));
      expect(await browser.execute(() => {
        const log = document.querySelector<HTMLElement>('[role="log"]')!;
        return log.scrollHeight - log.clientHeight - log.scrollTop;
      })).toBeLessThanOrEqual(2);
      await samplePaneMotion('close-right');
    }
  });
});

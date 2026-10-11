import assert from 'node:assert/strict';
import { browser, $ } from '@wdio/globals';
import { createEvaluationArtifact, isTerminalAssistant, requireLiveConfiguration, selectAssistant } from './liveEvaluationArtifacts.mjs';

export async function invokeNative<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync((command: string, args: Record<string, unknown>, done: (value: { ok: boolean; value?: unknown; error?: string }) => void) => {
    const native = (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    if (!native) return done({ ok: false, error: 'Real native IPC is required' });
    void native.invoke(command, args).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }));
  }, command, args);
  if (!result.ok) throw new Error(`${command}: ${result.error}`);
  return result.value as T;
}

type NativeNote = { noteId: string; path: string; title: string; markdown: string };
type Assistant = { id?: string; role: string; status: string };

export function createLiveNativeEvaluation() {
  // Read only: skipped suites may be registered without live configuration.
  const config = { endpoint: process.env.GNEAUX_LIVE_ENDPOINT, model: process.env.GNEAUX_LIVE_MODEL, output: process.env.GNEAUX_LIVE_OUTPUT };
  const artifact = createEvaluationArtifact(config);
  return {
    artifact,
    installHooks() {
      before(() => { requireLiveConfiguration(); artifact.write(); });
      beforeEach(function () { artifact.startCase(this.currentTest!.fullTitle()); });
      afterEach(function () {
        const test = this.currentTest!;
        artifact.finishCase(test.fullTitle(), test.state, test.err);
      });
      after(() => { if (config.output) artifact.write(); });
    },
    setup(run: () => Promise<void>) {
      before(async () => {
        artifact.startCase('fixture setup');
        try {
          await run();
          artifact.finishCase('fixture setup', 'passed');
        } catch (error) {
          artifact.finishCase('fixture setup', 'failed', error);
          throw error;
        }
      });
    },
    async configure({ access = 'approved', reasoningEffort = 'medium', lexicalOnly = false }: { access?: 'approved' | 'full'; reasoningEffort?: string; lexicalOnly?: boolean } = {}) {
      const { endpoint, model } = requireLiveConfiguration();
      await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
      const { atlasVisibility: _visibility, ...defaults } = await invokeNative<Record<string, unknown>>('chat_get_settings');
      await invokeNative('chat_set_defaults', { defaults: { ...defaults, provider: 'local', model, localModel: model, localBaseUrl: endpoint, defaultAccess: access, webAccess: 'off', reasoningEffort } });
      await invokeNative('chat_set_local_model_capabilities', { model, capabilities: { tools: true, images: false, audio: false, video: false, reasoningEffort } });
      if (lexicalOnly) {
        const semantic = await invokeNative<Record<string, unknown>>('get_semantic_settings');
        await invokeNative('set_semantic_settings', { settings: { ...semantic, semanticSearchEnabled: false } });
      }
    },
    async saveNote(title: string, markdown: string, currentPath: string | null = null): Promise<NativeNote> {
      const note = await invokeNative<NativeNote>('save_note', { title, markdown, currentPath });
      assert(note.path.includes('gneauxghts-native-e2e-'), 'Writes must land in the owned disposable native fixture');
      await invokeNative('finalize_note_editing_window', { noteId: note.noteId });
      await invokeNative('e2e_flush_vault_watcher_path', { path: note.path });
      return { ...note, markdown };
    },
    async waitForAnswer<T extends Assistant>(conversationId: string, options: { messageId?: string; excludeIds?: string[]; timeoutMs?: number; onUpdate?: (answer: T | undefined) => void } = {}): Promise<T> {
      let answer: T | undefined;
      try {
        await browser.waitUntil(async () => {
          const conversation = await invokeNative<{ messages: T[] }>('chat_get_conversation', { conversationId });
          answer = selectAssistant(conversation.messages, options) as T | undefined;
          options.onUpdate?.(answer);
          artifact.observeAnswer(conversationId, answer);
          return isTerminalAssistant(answer);
      }, { timeout: options.timeoutMs ?? 300_000, interval: 1000, timeoutMsg: `Native agent did not reach a terminal state in conversation ${conversationId}` });
      } finally { artifact.write(); }
      assert(answer);
      return answer;
    }
  };
}

export function passageIds(content: string): string[] {
  return [...new Set([...content.matchAll(/passage:([^\s)\]]+)/g)].map(match => match[1]))];
}

export async function resolvePassages<T extends Record<string, unknown>>(conversationId: string, ids: string[]) {
  const resolutions: Array<({ evidenceId: string; status: 'resolved' } & T) | { evidenceId: string; status: 'failed'; error: string }> = [];
  for (const evidenceId of new Set(ids)) {
    try { resolutions.push({ ...await invokeNative<T>('chat_resolve_passage', { conversationId, evidenceId }), evidenceId, status: 'resolved' }); }
    catch (error) { resolutions.push({ evidenceId, status: 'failed', error: String(error) }); }
  }
  return resolutions;
}

import assert from 'node:assert/strict';
import { readdirSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { browser, $ } from '@wdio/globals';
import type { PiChat, PI_CONTEXT } from '../../src/lib/features/chat/pi/runtime';
import type { PiViewSnapshot } from '../../src/lib/features/chat/ui/piConversationView';
import type { ConversationId, ConversationView, WatchHandle } from '@earendil-works/pi-durable';
import { invokeNative } from './liveNative';

export const LOCAL_PI_ENDPOINT = 'http://100.117.20.29:1234/v1';
export const LOCAL_PI_MODEL = 'qwen3.8-27b-gsq-rco';
type Pane = Pick<PiViewSnapshot, 'title' | 'view' | 'entries' | 'authority' | 'error'> & { paneId: string; conversationId: number | null };
type Progress = { observations: number; firstTextAt?: number; firstReasoningAt?: number; firstTerminalAt?: number; textWhileBusy: boolean; reasoningWhileBusy: boolean; uiTextWhileBusy: boolean; uiReasoningWhileBusy: boolean; compactionObserved: boolean };
type Probe = { native: ReturnType<typeof import('../../src/lib/e2e/piNativeInvokeProbe').installPiNativeInvokeProbe>; observerErrors: number; startedAt: number; conversations: Record<string, Progress>; stop(): void };
type Host = Window & {
  __GNEAUXGHTS_NATIVE_E2E__?: { piNativeInvokeProbe(): Promise<typeof import('../../src/lib/e2e/piNativeInvokeProbe')>; piChat(): Promise<PiChat>; piContext(): Promise<typeof PI_CONTEXT> | typeof PI_CONTEXT; piPublicationTask(): Promise<typeof import('../../src/lib/features/chat/pi/publication').PublicationTask>; readPiChatState(): Pane[]; setEditorSelection(anchor: number, head: number): boolean; readEditorState(): { noteId: string | null; workspaceOperationPending: boolean; editor: { markdown: string } | null } };
  __PI_CHAT_ACCEPTANCE__?: Probe;
  __PI_PUBLICATION_ACCEPTANCE__?: { stage: string; intentId: string; taskId?: number; inputAccepted?: boolean; publicationInvokesBefore?: number };
};
export const messages = (pane: Pane) => pane.entries.flatMap(entry => entry.model ?? []);
export const assistantText = (pane: Pane) => messages(pane).filter(message => message.role === 'assistant').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n');
export const live = (pane: Pane) => pane.view?.docs['pi.live'] as { run?: unknown; compactions?: unknown[] } | undefined;

export async function assertDisposable() {
  const root = process.env.GNEAUXGHTS_NATIVE_E2E_FIXTURE;
  assert(root && /gneauxghts-native-e2e-[^/]+$/.test(root), 'Pi acceptance requires the generated native fixture');
  const vault = await invokeNative<{ runningPath: string }>('get_vault_info');
  assert.equal(realpathSync(vault.runningPath), realpathSync(join(root, 'documents/vault')));
  const route = await browser.execute(() => location.pathname);
  assert.equal(route, '/', 'Acceptance must use the ordinary workspace');
  return root;
}
export async function configurePi(endpoint = LOCAL_PI_ENDPOINT, model = LOCAL_PI_MODEL) {
  await assertDisposable();
  await $('[data-testid="note-title"]').waitForExist({ timeout: 30_000 });
  const settings = await invokeNative<Record<string, unknown>>('chat_get_settings');
  await invokeNative('chat_set_defaults', { defaults: { ...settings, provider: 'local', model, localModel: model, localBaseUrl: endpoint, defaultAccess: 'full', reasoningEffort: 'on' } });
  await invokeNative('chat_set_local_model_capabilities', { model, capabilities: { tools: true, images: false, audio: false, video: false, reasoningEffort: 'on' } });
  const admitted = await invokeNative<Record<string, unknown>>('chat_get_settings');
  assert.equal(admitted.localBaseUrl, endpoint); assert.equal(admitted.localModel, model);
  return { endpoint, model };
}
export async function savePiFixtureNote(title: string, markdown: string, currentPath: string | null = null) {
  const root = await assertDisposable();
  const note = await invokeNative<{ noteId: string; title: string; path: string; markdown: string }>('save_note', { title, markdown, currentPath });
  const withinVault = relative(realpathSync(join(root, 'documents/vault')), realpathSync(note.path));
  assert(withinVault !== '..' && !withinVault.startsWith('../') && !withinVault.startsWith('..\\'), 'Canonical note target must remain inside the exact generated fixture vault');
  await invokeNative('finalize_note_editing_window', { noteId: note.noteId });
  await invokeNative('e2e_flush_vault_watcher_path', { path: note.path });
  return note;
}
export async function openPiPane() {
  try {
    if (!await $('[data-testid="pi-chat-panel"]').isExisting()) {
      const split = await $('[aria-label="Open split pane options"]');
      await split.waitForDisplayed();
      // The ordinary control opens on pointerenter as well as focus. Background
      // native windows can lose programmatic focus to startup editor focus.
      // Deliver its existing DOM event, then use the normal option click.
      // This does not claim an OS pointer gesture or foreground focus.
      await browser.execute((element: HTMLElement) => element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' })), split);
      await $('[aria-label="Split with thought partner"]').waitForExist();
      await $('[aria-label="Split with thought partner"]').click();
    }
    await $('[data-testid="pi-chat-panel"]').waitForDisplayed();
    await $('textarea[aria-label="Message"]').waitForEnabled();
  } catch (error) {
    const diagnostic = await browser.execute(() => {
      const describe = (element: Element | null) => element ? { tag: element.tagName, label: element.getAttribute('aria-label'), testId: element.getAttribute('data-testid'), connected: element.isConnected } : null;
      return { route: location.pathname, readyState: document.readyState, visibility: document.visibilityState, hasFocus: document.hasFocus(), viewport: { width: innerWidth, height: innerHeight }, activeElement: describe(document.activeElement),
        controls: [...document.querySelectorAll('.split-pane-control')].map(control => ({ splitClass: control.classList.contains('split-pane-control--split'), display: getComputedStyle(control).display, visibility: getComputedStyle(control).visibility, buttons: [...control.querySelectorAll('button')].map(button => ({ ...describe(button), disabled: button.disabled, inert: button.inert, rect: { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height } })) })),
        buttons: [...document.querySelectorAll('button[aria-label]')].map(describe), chatPanes: document.querySelectorAll('[data-testid="pi-chat-panel"]').length,
        hasNativeBridge: Boolean((window as Host).__GNEAUXGHTS_NATIVE_E2E__), observerInstalled: Boolean((window as Host).__PI_CHAT_ACCEPTANCE__) };
    }).catch(failure => ({ captureError: String(failure) }));
    await writePiReport('pi-open-pane-failure', { error: String(error), diagnostic });
    throw error;
  }
}
export async function paneState(): Promise<Pane> {
  const panes = await browser.execute(() => (window as Host).__GNEAUXGHTS_NATIVE_E2E__!.readPiChatState());
  assert.equal(panes.length, 1, 'Acceptance uses one real selected chat pane');
  return panes[0];
}
/** Embedded background clicks do not reliably deliver pane activation events. */
export async function activatePiEditor() {
  const editor = await $('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content');
  await editor.waitForExist();
  await browser.execute((element: HTMLElement) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    element.focus();
  }, editor);
  await browser.waitUntil(async () => await browser.execute(() => Boolean((window as Host).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState().editor)), {
    timeoutMsg: 'Mounted editor did not acquire workspace pane ownership'
  });
}
export async function newPiConversation() {
  await $('button[aria-label="Conversations"]').click();
  await $('button[data-new-conversation]').click();
  await browser.waitUntil(async () => (await paneState()).conversationId === null);
}
export async function sendPiMessage(text: string) {
  await $('textarea[aria-label="Message"]').setValue(text);
  const queue = await $('[aria-label="Queue message"]');
  if (await queue.isExisting()) await queue.click();
  else await $('[data-testid="pi-send"]').click();
  await browser.waitUntil(async () => (await paneState()).conversationId !== null);
  return (await paneState()).conversationId!;
}
export async function waitPiIdle(timeout = 180_000) {
  let pane: Pane | undefined;
  await browser.waitUntil(async () => {
    pane = await paneState();
    const user = pane.entries.findLast(entry => entry.model?.some(message => message.role === 'user'));
    const assistant = pane.entries.findLast(entry => entry.model?.some(message => message.role === 'assistant'));
    return Boolean(pane.conversationId && !live(pane)?.run && !live(pane)?.compactions?.length && assistant && (!user || assistant.id >= user.id));
  }, { timeout, interval: 200, timeoutMsg: 'Ordinary Pi chat did not settle' });
  return pane!;
}

/** Observe Pi commits and actual DOM deliveries; never retain provider bodies, headers or reasoning text. */
export async function observePi() {
  await browser.execute(() => new Promise<string | null>((done) => {
    void (async () => {
      const host = window as Host, bridge = host.__GNEAUXGHTS_NATIVE_E2E__;
      if (!bridge?.piChat || !bridge.piContext)
        throw new Error('Actual Pi runtime and Context hooks required');
      host.__PI_CHAT_ACCEPTANCE__?.stop();
      const native = (await bridge.piNativeInvokeProbe()).installPiNativeInvokeProbe();
      const runtime = await bridge.piChat(), context = await bridge.piContext();
      const stats: Probe = { native, observerErrors: 0, startedAt: performance.now(), conversations: {}, stop() { } };
      const watches = new Map<number, WatchHandle<ConversationView>>(), attaching = new Set<number>();
      const progress = (id: number) => stats.conversations[id] ??= { observations: 0, textWhileBusy: false, reasoningWhileBusy: false, uiTextWhileBusy: false, uiReasoningWhileBusy: false, compactionObserved: false };
      const sample = (id: number, view: ConversationView) => {
        const record = progress(id), state = view.docs['pi.live'] as {
          run?: unknown;
          generation?: {
            message?: {
              content: Array<{
                type: string;
                text?: string;
                thinking?: string;
              }>;
            };
          };
          compactions?: unknown[];
        } | undefined;
        record.observations++;
        record.compactionObserved ||= Boolean(state?.compactions?.length);
        if (state?.run)
          for (const block of state.generation?.message?.content ?? []) {
            if (block.type === 'text' && block.text) {
              record.textWhileBusy = true;
              record.firstTextAt ??= performance.now();
            }
            if (block.type === 'thinking' && block.thinking) {
              record.reasoningWhileBusy = true;
              record.firstReasoningAt ??= performance.now();
            }
          }
        if (!state?.run && view.entries.some(entry => entry.model?.some(message => message.role === 'assistant')))
          record.firstTerminalAt ??= performance.now();
      };
      let disposed = false;
      const attach = () => {
        for (const pane of bridge.readPiChatState()) {
          const id = pane.conversationId;
          if (!id || watches.has(id) || attaching.has(id))
            continue;
          attaching.add(id);
          void runtime.harness.conversation(id as ConversationId, context).then(async (conversation) => {
            if (!conversation)
              return;
            const watch = await conversation.watch(context);
            if (disposed) {
              await watch.stop();
              return;
            }
            watches.set(id, watch);
            sample(id, watch.value);
            watch.start(async (view) => { sample(id, view); });
          }).catch(() => { stats.observerErrors++; }).finally(() => attaching.delete(id));
        }
      };
      const unsubscribe = runtime.harness.subscribeCommits(() => queueMicrotask(attach));
      const observer = new MutationObserver(() => {
        attach();
        for (const pane of bridge.readPiChatState()) {
          if (!pane.conversationId)
            continue;
          const record = progress(pane.conversationId);
          const article = document.querySelector('[data-testid="pi-assistant-message"][data-streaming="true"]');
          if (article?.querySelector('.gn-markdown-surface')?.textContent?.trim())
            record.uiTextWhileBusy = true;
          if (document.querySelector('[data-testid="pi-reasoning"][data-streaming="true"] pre')?.textContent?.trim())
            record.uiReasoningWhileBusy = true;
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-streaming'] });
      stats.stop = () => { disposed = true; unsubscribe(); observer.disconnect(); for (const watch of watches.values())
        void watch.stop(); native.stop(); };
      host.__PI_CHAT_ACCEPTANCE__ = stats;
      attach();
    })().then(() => done(null), error => done(String(error)));
  })).then(error => { assert.equal(error, null); });
}
export async function piDiagnostics() {
  const progress = await browser.execute(() => {
    const probe = (window as Host).__PI_CHAT_ACCEPTANCE__;
    if (!probe) return { measured: false, measurementUnavailable: 'Pi observer was not installed; setup did not complete.', startedAt: null,
      bridge: {} as import('../../src/lib/e2e/piNativeInvokeProbe').PiNativeInvokeStats['bridge'], bridgeByteMeasurement: 'unmeasured', transport: { frames: 0, frameBytes: 0, providerBytes: 0 }, observerErrors: 0,
      requests: [] as import('../../src/lib/e2e/piNativeInvokeProbe').PiRequestObservation[], conversations: {} as Record<string, Progress> };
    const native = probe.native.read();
    return { measured: true, startedAt: probe.startedAt, bridge: native.bridge, bridgeByteMeasurement: 'serialized JSON IPC argument/result envelopes; excludes Tauri outer protocol overhead', transport: native.transport, observerErrors: probe.observerErrors, requests: native.requests, conversations: probe.conversations };
  });
  const root = await assertDisposable();
  const files: Array<{ path: string; bytes: number }> = [];
  const walk = (path: string) => { for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(target);
    else if (/\.sqlite3?(?:-(?:wal|shm))?$|\.db(?:-(?:wal|shm))?$/.test(entry.name)) files.push({ path: relative(root, target), bytes: lstatSync(target).size });
  } };
  walk(root);
  const processes = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' }).split('\n').filter(line => line.includes(root) && line.includes('--e2e-vault-root')).map(line => {
    const [pid, rssKiB] = line.trim().split(/\s+/).map(Number); return { pid, rssKiB };
  });
  return { progress, files, processes };
}
export async function writePiReport(name: string, evidence: unknown) {
  const output = process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT;
  if (!output) { console.info('PI_ACCEPTANCE', name, JSON.stringify(evidence)); return; }
  const destination = resolve(output);
  writeFileSync(join(destination, `${name}.json`), JSON.stringify(evidence, null, 2) + '\n');
}

export { startPiProviderFixture } from './piProviderFixture.mjs';

type CreatedPublicationTask = { id: number; editorAtTaskCreation?: { noteId: string | null; editor: { markdown: string } | null }; beforeInvokes: number };
export async function publishPiIntent(intent: import('../../src/lib/features/chat/pi/publication').PublicationIntent, body: string | null = null, afterTaskCreated?: (task: CreatedPublicationTask) => Promise<void>) {
  type Settled = { id: number; state: { status: string; outcome?: { status: string; result?: import('../../src/lib/features/chat/pi/publication').PublicationTaskResult; error?: unknown } } };
  let created: CreatedPublicationTask | undefined, latest: Settled | undefined;
  try {
    const result = await browser.execute((intent: import('../../src/lib/features/chat/pi/publication').PublicationIntent, body: string | null) => new Promise<{
      value?: unknown;
      error?: string;
    }>((done) => {
      void (async () => {
        const host = window as Host, bridge = host.__GNEAUXGHTS_NATIVE_E2E__!;
        const progress = host.__PI_PUBLICATION_ACCEPTANCE__ = { stage: 'opening-runtime', intentId: intent.intentId } as NonNullable<Host['__PI_PUBLICATION_ACCEPTANCE__']>;
        const runtime = await bridge.piChat(), context = await bridge.piContext(), task = await bridge.piPublicationTask();
        const pane = bridge.readPiChatState()[0];
        if (!pane?.conversationId)
          throw new Error('Select an actual conversation before synthetic publication');
        const conversation = await runtime.harness.conversation(pane.conversationId as ConversationId, context);
        if (!conversation)
          throw new Error('Actual Pi conversation unavailable');
        let editorAtTaskCreation: {
          noteId: string | null;
          editor: {
            markdown: string;
          } | null;
        } | undefined;
        if (body !== null) {
          progress.stage = 'editor-input';
          const editor = document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content');
          if (!editor)
            throw new Error('Mounted real editor required for dirty publication acceptance');
          editor.focus();
          const before = bridge.readEditorState();
          if (!before.editor || !bridge.setEditorSelection(0, before.editor.markdown.length) || !document.execCommand('insertText', false, body))
            throw new Error('Real editor input failed');
          // CodeMirror accepts desktop DOM mutations in its MutationObserver.
          // Let that callback and the owner update settle without depending on
          // animation frames, which stop in a background native WebView.
          await Promise.resolve();
          await Promise.resolve();
          editorAtTaskCreation = bridge.readEditorState();
          if (editorAtTaskCreation.editor?.markdown !== body)
            throw new Error('DOM input was not accepted by the real editor owner');
          progress.inputAccepted = true;
        }
        const beforeInvokes = (window as Host).__PI_CHAT_ACCEPTANCE__?.native.read().bridge.pi_chat_publish_mutation?.calls ?? 0;
        progress.stage = 'creating-task';
        progress.publicationInvokesBefore = beforeInvokes;
        const id = await conversation.commit(tx => tx.createTask(task, intent, { ownership: { kind: 'conversation' } }), context);
        progress.stage = 'task-created';
        progress.taskId = id;
        return { id, editorAtTaskCreation, beforeInvokes };
      })().then(value => done({ value }), error => done({ error: String(error) }));
    }), intent, body);
    assert(!result.error, result.error); created = result.value as CreatedPublicationTask;
    // Lifecycle acceptance may hold a real native acknowledgement and exercise
    // ordinary navigation before joining this same production Pi task.
    await afterTaskCreated?.(created);
    await browser.waitUntil(async () => {
      const read = await browser.execute((taskId: number) => new Promise<{
        value?: unknown;
        error?: string;
      }>((done) => {
        void (async () => { const bridge = (window as Host).__GNEAUXGHTS_NATIVE_E2E__!; const runtime = await bridge.piChat(), context = await bridge.piContext(); return runtime.harness.getTask(taskId as import('@earendil-works/pi-durable').TaskId, context); })().then(value => done({ value }), error => done({ error: String(error) }));
      }), created!.id);
      assert(!read.error, read.error); latest = read.value as Settled | undefined;
      return latest?.state.status === 'terminal';
    }, { timeout: 30_000, interval: 200, timeoutMsg: 'Actual Pi publication task did not become terminal' });
    assert(latest?.state.outcome);
    const publicationInvokes = await browser.execute(() => (window as Host).__PI_CHAT_ACCEPTANCE__?.native.read().bridge.pi_chat_publish_mutation?.calls ?? 0) - created.beforeInvokes;
    return { ...latest, state: { ...latest.state, outcome: latest.state.outcome }, editorAtTaskCreation: created.editorAtTaskCreation, publicationInvokes };
  } catch (error) {
    const diagnostic = await browser.execute(() => {
      const host = window as Host;
      const editor = host.__GNEAUXGHTS_NATIVE_E2E__?.readEditorState();
      return { progress: host.__PI_PUBLICATION_ACCEPTANCE__, native: host.__PI_CHAT_ACCEPTANCE__?.native.read(), editor: editor ? { noteId: editor.noteId, characters: editor.editor?.markdown.length } : undefined };
    }).catch(failure => ({ captureError: String(failure) }));
    await writePiReport('pi-publication-task-failure', { intentId: intent.intentId, error: String(error), createdTaskId: created?.id, latestTask: latest, diagnostic });
    throw error;
  }
}

/** Opt-in root-owned lifecycle journey, following the existing native restart path. */
export async function restartPiFixture() {
  const root = await assertDisposable();
  const pids = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter(line => line.includes(root) && line.includes('gneauxghts') && line.includes('--e2e-app-data-root') && line.includes('--e2e-documents-root') && line.includes('--e2e-vault-root')).map(line => Number(line.trim().split(/\s+/)[0]));
  const before = pids(); assert.equal(before.length, 1, 'Restart requires one exact fixture-owned app process');
  const beforeDiagnostics = await piDiagnostics();
  const readiness = await invokeNative<{ ready: boolean }>('prepare_restart'); assert.equal(readiness.ready, true);
  await browser.execute(() => { setTimeout(() => { void window.__TAURI_INTERNALS__!.invoke('plugin:process|restart', {}); }, 100); });
  let restarted: number | undefined;
  await browser.waitUntil(async () => {
    restarted = pids().find(pid => pid !== before[0]);
    if (!restarted) return false;
    writeFileSync(join(root, 'restarted-app.pid'), String(restarted));
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.TAURI_WEBDRIVER_PORT ?? 4445}/status`);
      const status = await response.json() as { value?: { ready?: boolean } };
      return response.ok && status.value?.ready === true;
    } catch { return false; }
  }, { timeout: 30_000, interval: 250, timeoutMsg: 'Exact fixture process did not restart its embedded driver' });
  await browser.reloadSession(); await browser.switchToWindow('main');
  await $('[data-testid="note-editor"]').waitForExist({ timeout: 30_000 });
  await openPiPane(); await observePi();
  // A selected chat can be visible before workspace restoration releases its
  // operation. Wait for the actual publication guard instead of retrying effects.
  await browser.waitUntil(async () => browser.execute(() =>
    !(window as Host).__GNEAUXGHTS_NATIVE_E2E__!.readEditorState().workspaceOperationPending
  ), { timeout: 30_000, interval: 100, timeoutMsg: 'Reopened workspace operation did not settle' });
  return { beforePid: before[0], afterPid: restarted!, beforeDiagnostics };
}

export async function seedPiSyntheticHistory(blocks: string[]) {
  const result = await browser.execute((blocks: string[]) => new Promise<{
    value?: unknown;
    error?: string;
  }>((done) => {
    void (async () => {
      const bridge = (window as Host).__GNEAUXGHTS_NATIVE_E2E__!, runtime = await bridge.piChat(), context = await bridge.piContext();
      const id = bridge.readPiChatState()[0]?.conversationId;
      if (!id)
        throw new Error('A real selected conversation is required');
      const conversation = await runtime.harness.conversation(id as ConversationId, context);
      if (!conversation)
        throw new Error('Unknown conversation');
      for (const content of blocks) {
        const submission = await conversation.submit({ type: 'write', entry: { kind: 'acceptance.synthetic-history', data: { generated: true }, model: [{ role: 'user', content, timestamp: Date.now() }] } }, context);
        await submission.wait(context);
      }
      const view = await conversation.context(context);
      return { conversationId: id, entries: view.entries.length, characters: JSON.stringify(view.messages).length };
    })().then(value => done({ value }), error => done({ error: String(error) }));
  }), blocks);
  assert(!result.error, result.error);
  return result.value as { conversationId: number; entries: number; characters: number };
}
export async function inspectPiContext() {
  const result = await browser.execute(() => new Promise<{
    value?: unknown;
    error?: string;
  }>((done) => {
    void (async () => {
      const bridge = (window as Host).__GNEAUXGHTS_NATIVE_E2E__!, runtime = await bridge.piChat(), context = await bridge.piContext();
      const id = bridge.readPiChatState()[0]?.conversationId;
      if (!id)
        throw new Error('No selected conversation');
      const conversation = await runtime.harness.conversation(id as ConversationId, context);
      if (!conversation)
        throw new Error('Unknown conversation');
      const current = await conversation.context(context);
      const history = await conversation.entries({ order: 'ascending' }, 100, undefined, context);
      const usage = await runtime.harness.usage(context);
      const agent = await conversation.agent(context);
      const resolved = agent.model ? runtime.models.getModel(agent.model.provider, agent.model.modelId) : undefined;
      const model = resolved ? { provider: resolved.provider, id: resolved.id, contextWindow: resolved.contextWindow, maxTokens: resolved.maxTokens } : undefined;
      return { model, head: current.head, contextCharacters: JSON.stringify(current.messages).length, historyKinds: history.items.map(entry => ({ id: entry.id, kind: entry.kind, data: entry.data })), historyNext: history.next, usage };
    })().then(value => done({ value }), error => done({ error: String(error) }));
  }));
  assert(!result.error, result.error);
  return result.value as { model?: { provider: string; id: string; contextWindow: number; maxTokens: number }; head?: { id: number; kind: string }; contextCharacters: number; historyKinds: Array<{ id: number; kind: string; data?: unknown }>; usage: unknown; historyNext?: unknown };
}

export async function waitPiTask(taskId: number) {
  const result = await browser.execute((taskId: number) => new Promise<{
    value?: unknown;
    error?: string;
  }>((done) => {
    void (async () => { const bridge = (window as Host).__GNEAUXGHTS_NATIVE_E2E__!; const runtime = await bridge.piChat(), context = await bridge.piContext(); return runtime.harness.waitForTask(taskId as import('@earendil-works/pi-durable').TaskId, context); })().then(value => done({ value }), error => done({ error: String(error) }));
  }), taskId);
  assert(!result.error, result.error);
  return result.value as { state: { outcome: { status: string } } };
}

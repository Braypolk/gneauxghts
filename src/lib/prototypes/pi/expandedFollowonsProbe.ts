// Run in the existing native workspace, explicitly opted in by the fixture
// launcher. Public ChatApi operations retain native admission and Pi tasks.
import { invoke } from '@tauri-apps/api/core';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import type { ChatAttachmentInput, ChatMessage, ChatProvider } from '$lib/features/chat/types';
import { nativeTransportStats } from './nativeProvider';
import { acquireFollowonsConversation, type FollowonsConversationControls } from './followonsConversation';

export type FollowonsReport = {
  gate: 'expanded-native-followons-fixture'; status: 'running' | 'passed' | 'failed';
  run: string; checks: string[]; receipts: Record<string, unknown>; error?: string;
  driverRequirements: string[];
};
const api = chatApi as ChatApi & { prototypeState(): Promise<{ followonsStateJson?: string }>; prototypeCheckpoint(value: unknown): Promise<void> };
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until<T>(read: () => T | Promise<T>, description: string, timeout = 120000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await read(); if (result) return result as NonNullable<T>; await pause(); }
  throw new Error(`Follow-on deadline: ${description}`);
}
function button(label: string, root: ParentNode = document) { return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && (node.getAttribute('aria-label') === label || node.textContent?.trim() === label)); }
async function click(label: string, root: ParentNode = document) { (await until(() => button(label, root), label)).click(); await pause(); }
function input(field: HTMLInputElement | HTMLTextAreaElement, value: string) { field.focus(); field.value = value; field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); }
async function sendComposer(content: string) {
  const field = await until(() => { const node = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]'); return node && !node.disabled ? node : undefined; }, 'normal composer');
  input(field, content); await click('Send message');
}
const conversationControls: FollowonsConversationControls = {
  focusChat: async () => {
    if (!document.querySelector('[aria-label="Thought partner chat"]')) await click('Open thought partner');
    // The inactive chat's docked composer may be hidden. Activate through its
    // pane-local visible header, expanding a compact rail through normal UI.
    const rail = document.querySelector<HTMLButtonElement>('[data-pane-kind="chat"][data-pane-collapsed] button.pane-rail-surface:not(:disabled)');
    if (rail) { rail.click(); await pause(); }
    const title = await until(() => { const node = document.querySelector<HTMLInputElement>('[data-pane-kind="chat"] [aria-label="Chat title"]'); return node && !node.closest('[inert], [hidden]') && node.getClientRects().length ? node : undefined; }, 'visible chat header before New Chat');
    title.focus();
    await until(() => button('New Chat. Start a blank chat in this pane.'), 'chat header focus activates New Chat action');
    const composer = await until(() => Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]')).find(node => !node.disabled && !node.closest('[inert], [hidden]') && node.getClientRects().length), 'visible mounted chat composer before New Chat');
    composer.focus();
    await until(() => document.activeElement === composer && button('New Chat. Start a blank chat in this pane.'), 'chat focus activates pane and New Chat action');
  },
  newChat: async () => {
    await click('New Chat. Start a blank chat in this pane.');
    await until(() => document.querySelector<HTMLInputElement>('[aria-label="Chat title"]')?.value === '', 'blank mounted chat draft');
  },
  title: async title => {
    const field = await until(() => document.querySelector<HTMLInputElement>('[aria-label="Chat title"]'), 'draft title');
    input(field, title); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause();
  },
  model: async (provider, model) => {
    await click('AI model'); const picker = await until(() => document.querySelector('[aria-label="AI model picker"]'), 'normal model picker');
    await click(provider === 'local' ? 'Server' : 'ChatGPT', picker);
    input(await until(() => picker.querySelector<HTMLInputElement>('[aria-label="Custom model ID"]'), 'model ID'), model);
    await click('Use', picker);
    await until(() => button('AI model')?.title === `${provider === 'local' ? 'Server' : 'ChatGPT'} · ${model}`, 'draft model configuration');
  },
  vault: async () => {
    await click('Vault access'); const menu = await until(() => document.querySelector('[role="menu"][aria-label="Vault access"]'), 'vault access menu');
    (await until(() => Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find(node => node.querySelector('span.font-medium')?.textContent === 'Full vault'), 'Full vault choice')).click();
    await until(() => button('Vault access')?.textContent?.includes('Full vault'), 'full vault draft');
  },
  reasoning: async () => {
    await click('Reasoning effort'); const picker = await until(() => document.querySelector('[aria-label="Reasoning effort picker"]'), 'reasoning picker');
    await click('Off', picker); await until(() => !document.querySelector('[aria-label="Reasoning effort picker"]') && button('Reasoning effort')?.textContent?.includes('Off'), 'off reasoning draft');
  },
  send: sendComposer,
  accepted: async (title, content) => {
    const id = await until(async () => (await api.listConversations()).find(item => item.title === title)?.id, 'first Send creates configured conversation');
    const conversation = await until(async () => { const value = await api.getConversation(id); return value.messages.some(item => item.role === 'user' && item.content === content) && value.messages.at(-1)?.role === 'assistant' ? value : undefined; }, 'first WARMUP admission');
    completed(await terminal(id, conversation.messages.at(-1)!.id));
    await until(() => document.querySelector<HTMLInputElement>('[aria-label="Chat title"]')?.value === title, 'first Send selects created conversation');
    await until(() => document.querySelector(`[data-chat-message-id="${conversation.messages.at(-1)!.id}"]`)?.textContent?.includes('Synthetic'), 'first WARMUP renders in selected chat');
    return api.getConversation(id);
  }
};
async function terminal(id: string, messageId: string) {
  const message = await until(async () => { const value = (await api.getConversation(id)).messages.find(item => item.id === messageId); return value && !['pending', 'streaming'].includes(value.status) ? value : undefined; }, 'terminal actual Pi request');
  await pause(); return message;
}
function completed(message: ChatMessage) { assert(message.status === 'completed', `Follow-on request ${message.status}: ${message.errorMessage}`); return message; }
async function sendUi(id: string, content: string) {
  const before = (await api.getConversation(id)).messages.length;
  await sendComposer(content);
  const messageId = await until(async () => { const messages = (await api.getConversation(id)).messages; return messages.length > before && messages.at(-1)?.role === 'assistant' ? messages.at(-1)?.id : undefined; }, 'UI admission');
  const result = completed(await terminal(id, messageId));
  await until(() => Array.from(document.querySelectorAll('[aria-label="Assistant response"]')).some(node => node.textContent?.includes('Synthetic')), 'normal rendered follow-on answer');
  return result;
}
async function sendApi(input: Parameters<ChatApi['sendMessage']>[0]) { const receipt = await api.sendMessage(input); assert(receipt.assistantMessage, 'Missing accepted assistant receipt'); return terminal(input.conversationId, receipt.assistantMessage.id); }
function attachment(name: string, mimeType: string, bytes: string, kind: 'file' | 'image' = 'file'): ChatAttachmentInput {
  return { name, mimeType, kind, sizeBytes: new TextEncoder().encode(bytes).length, dataBase64: btoa(bytes) };
}
function noteCitations(message: ChatMessage) { return message.citations.filter(item => item.kind === 'note'); }

export async function runExpandedFollowonsProbe(): Promise<FollowonsReport | undefined> {
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean; followonsGate?: boolean }>('pi_probe_config');
  if (!config.fixture || !config.interactiveGate || !config.expandedGate || !config.followonsGate || !new URL(location.href).searchParams.has('piExpandedTest')) return;
  const report: FollowonsReport = { gate: 'expanded-native-followons-fixture', status: 'running', run: crypto.randomUUID(), checks: [], receipts: {},
    driverRequirements: ['verifyFollowonsReceipts: actual parent and worker summary requests in both protocols', 'verifyFollowonsReceipts: native attachment payload and exact Retry wire bytes', 'verifyFollowonsReceipts: initial forced hosted web and released continuation'] };
  const mark = async (check: string, receipt: unknown) => { report.checks.push(check); report.receipts[check] = receipt; await invoke('pi_ui_report', { report }); };
  try {
    await until(() => document.querySelector('[data-testid="workspace-pane"]'), 'normal native workspace');
    const notes: string[] = [];
    // Genuine safely reducible canonical tool output: enough bytes to cross
    // the ordinary unknown-capacity policy, with no direct harness mutation.
    for (let index = 0; index < 30; index++) {
      const saved = await invoke<{ noteId: string }>('save_note', { title: `Pi followons ${report.run} ${index}`, markdown: `Synthetic follow-on canonical note ${index}.\n${'Synthetic bounded evidence for continuation. '.repeat(110)}`, currentPath: null });
      notes.push(saved.noteId); await invoke('finalize_note_editing_window', { noteId: saved.noteId });
    }
    await mark('synthetic canonical notes created through native command', { count: notes.length });
    const conversations: Record<string, string> = {};
    for (const provider of ['local', 'openai'] as ChatProvider[]) {
      const conversation = await acquireFollowonsConversation(conversationControls, { title: `Pi followons ${provider} ${report.run}`, provider, model: 'pi-native-fixture', reasoningEffort: 'off', vaultAccess: 'full' }, `PI_FOLLOWONS:WARMUP:${report.run}_${provider}_0`);
      conversations[provider] = conversation.id;
      await mark(`${provider} normal New Chat and first WARMUP preserve configured admission`, { conversationId: conversation.id, provider: conversation.provider, model: conversation.model, reasoningEffort: conversation.reasoningEffort, vaultAccess: conversation.vaultAccess });
      for (let index = 1; index < 7; index++) await sendUi(conversation.id, `PI_FOLLOWONS:WARMUP:${report.run}_${provider}_${index}`);
      await sendUi(conversation.id, `PI_FOLLOWONS:PARENT:${report.run}_${provider}`);
      await mark(`${provider} normal UI long-history continuation completed`, { conversationId: conversation.id, warmupTurns: 7, driverVerificationRequired: true });
      const researched = await sendUi(conversation.id, `PI_FOLLOWONS:RESEARCH:${report.run}_${provider}:${notes.join(',')}`);
      assert(noteCitations(researched).length > 0, 'Research answer lacks native-issued passages');
      const researchTool = researched.parts.find(part => part.type === 'tool' && part.name === 'research_notes');
      assert(researchTool?.type === 'tool' && researchTool.status === 'success', 'Research did not finish through actual parent tool');
      await mark(`${provider} normal UI research worker handoff admitted`, { messageId: researched.id, citationCount: noteCitations(researched).length, toolStatus: researchTool.status });
      const fresh = await sendUi(conversation.id, `PI_FOLLOWONS:FRESH:${report.run}_${provider}:${notes[0]}`);
      assert(noteCitations(fresh).some(item => item.noteId === notes[0]), 'Follow-up did not acquire fresh current evidence');
      assert(fresh.parts.some(part => part.type === 'tool' && part.name === 'read_note' && part.status === 'success'), 'Follow-up reused prior answer instead of reading');
      await mark(`${provider} follow-up reads fresh native evidence`, { messageId: fresh.id });

      const text = attachment('pi-followons-attachment.txt', 'text/plain', 'synthetic-attachment-bytes');
      const attached = completed(await sendApi({ conversationId: conversation.id, content: `PI_FOLLOWONS:ATTACH:${report.run}_${provider}`, attachments: [text] }));
      const attachedUser = (await api.getConversation(conversation.id)).messages.findLast(item => item.role === 'user');
      assert(attachedUser?.attachments?.[0]?.dataBase64 === text.dataBase64, 'Durable attachment bytes were omitted');
      await mark(`${provider} public API native text attachment delivery`, { messageId: attached.id, attachmentId: attachedUser.attachments[0].id, byteLength: text.sizeBytes });
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1lEAAAAASUVORK5CYII=';
      const image: ChatAttachmentInput = { name: 'pi-followons-image.png', kind: 'image', mimeType: 'image/png', dataBase64: png, sizeBytes: atob(png).length };
      // Media byte samples are opaque fixture payloads. These checks observe
      // native wire delivery, rather than claiming live model interpretation.
      const samples = provider === 'local'
        ? [image, attachment('pi-followons-audio.wav', 'audio/wav', 'RIFFsynthetic-audio-bytes'), attachment('pi-followons-video.mp4', 'video/mp4', 'synthetic-video-bytes')]
        : [image, attachment('pi-followons-file.pdf', 'application/pdf', '%PDF-1.4 synthetic-pdf-bytes')];
      for (const sample of samples) {
        const modality = sample.mimeType.startsWith('image/') ? 'IMAGE' : sample.mimeType.startsWith('audio/') ? 'AUDIO' : sample.mimeType.startsWith('video/') ? 'VIDEO' : 'PDF';
        const delivered = completed(await sendApi({ conversationId: conversation.id, content: `PI_FOLLOWONS:ATTACH_${modality}:${report.run}_${provider}`, attachments: [sample] }));
        await mark(`${provider} public API native ${modality.toLowerCase()} payload delivery`, { messageId: delivered.id, byteLength: sample.sizeBytes, driverVerificationRequired: true });
      }
      const failed = await sendApi({ conversationId: conversation.id, content: `PI_FOLLOWONS:ATTACH_RETRY:${report.run}_${provider}`, attachments: [text] });
      assert(failed.status === 'error', 'Attachment first attempt was not deliberately rejected');
      const original = (await api.getConversation(conversation.id)).messages.findLast(item => item.role === 'user');
      const originalBytes = JSON.stringify(original?.attachments);
      const retry = await api.retryMessage(failed.id); assert(retry.assistantMessage, 'Missing accepted Retry receipt'); completed(await terminal(conversation.id, retry.assistantMessage.id));
      const retried = (await api.getConversation(conversation.id)).messages.findLast(item => item.role === 'user');
      assert(JSON.stringify(retried?.attachments) === originalBytes, 'Retry changed attachment identity or bytes');
      await mark(`${provider} public API explicit Retry retains exact attachment`, { originalMessageId: failed.id, retryMessageId: retry.assistantMessage.id, attachmentId: retried?.attachments?.[0]?.id });

      const before = (await api.getConversation(conversation.id)).messages.length;
      let rejected = false;
      try { await api.sendMessage({ conversationId: conversation.id, content: 'Rejected attachment must not become a turn', attachments: [{ ...text, sizeBytes: text.sizeBytes + 1 }] }); } catch { rejected = true; }
      assert(rejected && (await api.getConversation(conversation.id)).messages.length === before, 'Malformed attachment was accepted into Pi');
      await mark(`${provider} malformed attachment rejected before durable acceptance`, { messageCount: before });
      if (provider === 'local') {
        for (const input of [{ attachments: [attachment('unsupported.pdf', 'application/pdf', '%PDF-1.4 synthetic')] }, { forceWebSearch: true }]) {
          let denied = false; try { await api.sendMessage({ conversationId: conversation.id, content: 'Unsupported native policy', ...input }); } catch { denied = true; }
          assert(denied && (await api.getConversation(conversation.id)).messages.length === before, 'Unsupported compatible capability accepted a turn');
        }
        await mark('compatible PDF and forced web rejected before durable acceptance', { messageCount: before });
      }
    }
    const hosted = conversations.openai;
    const web = completed(await sendApi({ conversationId: hosted, content: `PI_FOLLOWONS:WEB:${report.run}:${notes[0]}`, forceWebSearch: true }));
    assert(web.citations.some(item => item.kind === 'web' && item.url === 'https://example.com/pi-followons'), 'Authored hosted web URL not projected');
    assert(noteCitations(web).length > 0, 'Vault and web sources were not retained separately');
    await mark('public API hosted web and separate vault sources admitted', { messageId: web.id, sourceKinds: web.citations.map(item => item.kind) });
    assert(api.prepareNoteSave && api.getProposalDraft, 'Save review API unavailable');
    const transportBefore = { ...nativeTransportStats };
    for (const selection of [undefined, { markdown: '[Synthetic web source](https://example.com/pi-followons)', text: 'Synthetic web source' }]) {
      const proposal = await api.prepareNoteSave(hosted, web.id, selection);
      const draft = await api.getProposalDraft(proposal.id);
      assert(draft.markdown.includes('https://example.com/pi-followons'), 'Saved whole/selection draft lost authored web link');
      assert(draft.markdown.includes('Open in chat'), 'Saved whole/selection draft lost source-chat navigation');
      await api.dismissAgentProposal(proposal.id);
    }
    assert(nativeTransportStats.bytes === transportBefore.bytes && nativeTransportStats.chunks === transportBefore.chunks, 'Deterministic web Save invoked inference');
    await mark('whole and selection web Save preserve links without inference', { drafts: 2 });
    await api.prototypeCheckpoint({ followonsStateJson: JSON.stringify({ run: report.run, conversations, notes }) });
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error); }
  await invoke('pi_ui_report', { report });
  return report;
}

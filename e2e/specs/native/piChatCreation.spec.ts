import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser } from '@wdio/globals';
import { assertDisposable, configurePi, newPiConversation, observePi, openPiPane, paneState, restartPiFixture, sendPiMessage, startPiProviderFixture, waitPiIdle } from '../../support/piChatAcceptance';

/** Real model protocol → Pi tool/review → native create-only NoteTimeline publication. */
describe('Pi note creation through ordinary chat', function () {
  this.timeout(180_000);
  let provider: Awaited<ReturnType<typeof startPiProviderFixture>>;
  let vault: string;
  before(async () => {
    provider = await startPiProviderFixture();
    await configurePi(provider.endpoint, provider.model); await openPiPane(); await observePi();
    vault = join(await assertDisposable(), 'documents/vault');
  });
  after(async () => { await provider?.close(); });
  beforeEach(async () => { await newPiConversation(); });
  async function permission(create = true) {
    // Establish authority through the normal submission path.
    await sendPiMessage('Prepare a new note'); await waitPiIdle();
    await $('[aria-label="Vault access"]').click(); await $('button*=Allow edits in this chat').click();
    if (create) {
      await $('[aria-label="Vault access"]').click(); await $('button*=Allow creating new notes').click();
      await browser.waitUntil(async () => {
        const grant = (await paneState()).authority?.write.grant;
        return grant?.duration !== 'off' && grant?.operations.includes('create') === true;
      });
    }
  }
  async function submit(title: string, folder?: string) {
    provider.setCreate({ title, markdown: '# Plan\n\nWalk for 30 minutes.\n', ...(folder ? { folder } : {}) });
    const prompt = `fixture-create: ${title} ${Date.now()}`;
    await sendPiMessage(prompt);
    await browser.waitUntil(async () => (await paneState()).entries.some(entry => entry.model?.some(message =>
      message.role === 'user' && JSON.stringify(message.content).includes(prompt))));
  }
  async function review(title: string, folder?: string) {
    await permission(); await submit(title, folder);
    const card = await $('[data-testid="pi-edit-review"]');
    await card.waitForDisplayed({ timeout: 30_000 });
    assert((await card.getText()).includes(`Create ${title}`));
    assert((await card.getText()).includes(folder ? `${folder}/${title}.md` : `${title}.md`));
    assert((await $('[aria-label="New note content"]').getText()).includes('Walk for 30 minutes.'));
    const path = join(vault, folder ?? '', `${title}.md`);
    assert(!existsSync(path));
    return path;
  }
  function creationResult(pane: Awaited<ReturnType<typeof paneState>>) {
    const tool = pane.entries.flatMap(entry => entry.model ?? []).find(message => message.role === 'toolResult' && message.toolName === 'create_note');
    assert(tool?.role === 'toolResult');
    return JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join(''));
  }
  it('requires explicit creation permission even when editing is allowed', async () => {
    await permission(false);
    await submit('Pi creation denied');
    const pane = await waitPiIdle();
    assert.equal(creationResult(pane).code, 'operation_denied');
    assert(!existsSync(join(vault, 'Pi creation denied.md')));
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);
  });
  it('reviews new content by default and returns a verified fresh citation after creating', async () => {
    mkdirSync(join(vault, 'Projects'), { recursive: true });
    const path = await review('Pi created plan', 'Projects');
    if (process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT) await $('[data-testid="pi-edit-review"]').saveScreenshot(`${process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT}/pi-create-review.png`);
    await $('button=Create note').click();
    const pane = await waitPiIdle(), result = creationResult(pane);
    assert.equal(result.status, 'committed');
    const canonical = readFileSync(path, 'utf8');
    assert(canonical.includes('Walk for 30 minutes.'));
    assert.equal(result.read.markdown, canonical);
    assert(result.read.source.noteId && result.read.citation);
    assert.equal(await $('[data-pi-source]').getAttribute('data-pi-source'), result.read.source.sourceId);
    await $('[data-pi-source]').click();
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed();
    assert.equal((await paneState()).error, null);
  });
  it('discards and stops pending creation without leaving a file', async () => {
    const discarded = await review('Pi discarded creation');
    await $('button=Discard creation').click(); await waitPiIdle();
    assert(!existsSync(discarded));
    await newPiConversation();
    const stopped = await review('Pi stopped creation');
    await $('[data-testid="pi-stop"]').click();
    await browser.waitUntil(async () => !await $('[data-testid="pi-edit-review"]').isExisting());
    assert(!existsSync(stopped));
  });
  it('preserves a destination occupied after review without creating a suffixed copy', async () => {
    const path = await review('Pi occupied creation');
    writeFileSync(path, 'Human note wins.');
    await $('button=Create note').click();
    const pane = await waitPiIdle();
    assert.equal(creationResult(pane).code, 'target_exists');
    assert.equal(readFileSync(path, 'utf8'), 'Human note wins.');
    assert.deepEqual(readdirSync(vault).filter(name => name.startsWith('Pi occupied creation')), ['Pi occupied creation.md']);
  });
  (process.env.GNEAUX_PI_PROCESS_RESTART === '1' ? it : it.skip)('reopens the same pending creation and retains one note after a second process restart', async () => {
    const path = await review('Pi restart creation');
    const id = (await paneState()).conversationId;
    const reopen = async () => {
      await restartPiFixture();
      if ((await paneState()).conversationId !== id) {
        await $('button[aria-label="Conversations"]').click(); await $(`button[data-conversation-id="${id}"]`).click();
      }
    };
    await reopen();
    await $('[data-testid="pi-edit-review"]').waitForDisplayed({ timeout: 30_000 });
    assert(!existsSync(path));
    await $('button=Create note').click();
    const result = creationResult(await waitPiIdle());
    assert.equal(result.status, 'committed');
    const canonical = readFileSync(path, 'utf8');
    await reopen(); await waitPiIdle();
    assert.equal(creationResult(await paneState()).receiptId, result.receiptId);
    assert.equal(readFileSync(path, 'utf8'), canonical);
    assert.deepEqual(readdirSync(vault).filter(name => name.startsWith('Pi restart creation')), ['Pi restart creation.md']);
    await submit('Pi restart creation');
    assert.equal(creationResultLast(await waitPiIdle()).code, 'target_exists');
    assert.equal(readFileSync(path, 'utf8'), canonical);
  });
  function creationResultLast(pane: Awaited<ReturnType<typeof paneState>>) {
    const tools = pane.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'create_note');
    const tool = tools.at(-1); assert(tool?.role === 'toolResult');
    return JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join(''));
  }
});

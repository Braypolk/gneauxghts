import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { $, browser } from '@wdio/globals';
import { navigateAppTab } from '../../support/appNavigation';
import { configurePi, newPiConversation, observePi, openPiPane, paneState, restartPiFixture, savePiFixtureNote, sendPiMessage, startPiProviderFixture, waitPiIdle } from '../../support/piChatAcceptance';

/** Real model protocol → Pi edit tool/review → native NoteTimeline, in a disposable vault. */
describe('Pi note editing through the ordinary chat UI', function () {
  this.timeout(180_000);
  let provider: Awaited<ReturnType<typeof startPiProviderFixture>>;
  before(async () => { provider = await startPiProviderFixture(); await configurePi(provider.endpoint, provider.model); await openPiPane(); await observePi(); });
  after(async () => { await provider?.close(); });
  beforeEach(async () => { await newPiConversation(); });
  async function writeDefaults(duration: 'off' | 'always', review: boolean) {
    await navigateAppTab('Settings');
    await $('[data-settings-section="ai"]').click();
    const select = await $('[data-settings-anchor="chat-write-access"] select');
    await select.waitForDisplayed();
    // The embedded driver's option click does not deliver a select change.
    // Exercise the mounted control's normal change handler in the background fixture.
    await browser.execute((element: HTMLElement, value: string) => {
      (element as HTMLSelectElement).value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, select, duration);
    const checkbox = await $('[data-settings-anchor="chat-write-review"] input');
    if (await checkbox.isSelected() !== review) await checkbox.click();
    await $('button=Save editing defaults').click();
    await $('p=Editing defaults saved in this vault.').waitForDisplayed();
    if (process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT) await browser.saveScreenshot(`${process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT}/write-defaults.png`);
    await navigateAppTab('Gneauxght');
  }
  it('configures vault editing defaults through Settings and enforces them in chat', async () => {
    await writeDefaults('always', false);
    if (process.env.GNEAUX_PI_PROCESS_RESTART === '1') await restartPiFixture();
    const note = await savePiFixtureNote('Pi Settings direct edit', 'Alpha native editing slice.');
    provider.setEdit({ noteId: note.noteId, oldText: 'Alpha', newText: 'Beta' });
    await sendPiMessage('fixture-edit with Settings defaults');
    let pane = await waitPiIdle();
    assert.equal(pane.authority?.write.grant.duration, 'always');
    assert.equal(pane.authority?.write.reviewBeforeApplying, false);
    assert(readFileSync(note.path, 'utf8').includes('Beta native editing slice.'));
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);

    // Both surfaces read the same grant; a chat change is visible in Settings.
    await $('[aria-label="Vault access"]').click();
    await $('button[role="menuitemradio"]*=Editing off').click();
    await navigateAppTab('Settings');
    await $('[data-settings-section="ai"]').click();
    const select = await $('[data-settings-anchor="chat-write-access"] select');
    await select.waitForDisplayed();
    assert.equal(await select.getValue(), 'off');
    assert.equal(await $('[data-settings-anchor="chat-write-review"] input').isSelected(), false);
    await navigateAppTab('Gneauxght');

    await writeDefaults('always', true);
    await newPiConversation();
    const pending = await savePiFixtureNote('Pi Settings revoked review', 'Alpha native editing slice.');
    provider.setEdit({ noteId: pending.noteId, oldText: 'Alpha', newText: 'Beta' });
    await sendPiMessage('fixture-edit before Settings revocation');
    await $('[data-testid="pi-edit-review"]').waitForDisplayed({ timeout: 30_000 });
    await writeDefaults('off', true);
    await $('button*=Apply edit').click();
    pane = await waitPiIdle();
    assert(readFileSync(pending.path, 'utf8').includes('Alpha native editing slice.'));
    assert.equal(pane.authority?.write.grant.duration, 'off');
    assert(JSON.stringify(pane.entries).includes('stale_authority'));
  });
  async function edit(title: string, historicalCitation = false) {
    const note = await savePiFixtureNote(title, 'Alpha native editing slice.');
    provider.setEdit({ noteId: note.noteId, oldText: 'Alpha', newText: 'Beta' });
    await $('[aria-label="Vault access"]').click();
    await $('button[role="menuitemradio"]*=Allow edits in this chat').click();
    await browser.waitUntil(async () => (await paneState()).authority?.write.grant.duration === 'temporary');
    await sendPiMessage(`${historicalCitation ? 'fixture-edit-historical' : 'fixture-edit'}: change Alpha to Beta in the saved note.`);
    await $('[data-testid="pi-edit-review"]').waitForDisplayed({ timeout: 30_000 });
    assert.equal(await $('[aria-label="Proposed changes"]').getAttribute('data-layout'), 'inline');
    assert.equal(await $('[data-testid="pi-edit-inline"] del').getText(), 'Alpha');
    assert.equal(await $('[data-testid="pi-edit-inline"] ins').getText(), 'Beta');
    const changes = await $('[aria-label="Proposed changes"]').getText();
    assert(!changes.includes('updated_at:') && !changes.includes('@@') && !changes.includes('/note.md'));
    assert(readFileSync(note.path, 'utf8').includes('Alpha native editing slice.'));
    return note;
  }
  it('applies the exact reviewed replacement through the native publication owner', async () => {
    const note = await edit('Pi reviewed model edit');
    if (process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT) await $('[data-testid="pi-edit-review"]').saveScreenshot(`${process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT}/pi-edit-review.png`);
    await $('button*=Apply edit').click(); const pane = await waitPiIdle();
    assert(readFileSync(note.path, 'utf8').includes('Beta native editing slice.'));
    assert(JSON.stringify(pane.entries).includes('"status":"committed"'));
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);
    const tool = pane.entries.flatMap(entry => entry.model ?? []).find(message => message.role === 'toolResult' && message.toolName === 'edit_note');
    assert(tool?.role === 'toolResult');
    const result = JSON.parse(tool.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    assert(result.read.markdown.includes('Beta native editing slice.'));
    assert.equal(result.read.source.readState, undefined);
    const details = tool.details as { source?: { readState?: { contentHash?: string } } };
    assert(details.source?.readState?.contentHash);
    assert.equal(await $('[data-pi-source]').getAttribute('data-pi-source'), result.read.source.sourceId);
    await $('[data-pi-source]').click();
    const editor = await $('[data-testid="note-editor"] .cm-content');
    await editor.waitForDisplayed();
    await browser.waitUntil(async () => (await editor.getText()).includes('Beta native editing slice.'));
    await $('textarea[aria-label="Message"]').click();
    assert.equal((await paneState()).error, null);
    assert.equal(await $('[aria-label="Dismiss chat error"]').isExisting(), false);
    assert.equal(await $('[data-testid="pi-source-notice"]').isExisting(), false);
  });
  it('identifies the section and whitespace in both review layouts without changing the candidate', async () => {
    const before = '# First project\n\nStatus: Open\n\n# Second project\n\nBuy milk\n';
    const note = await savePiFixtureNote('Pi section and spacing review', before);
    provider.setEdit({ noteId: note.noteId, oldText: 'Buy milk', newText: 'Buy  milk' });
    await $('[aria-label="Vault access"]').click();
    await $('button[role="menuitemradio"]*=Allow edits in this chat').click();
    await browser.waitUntil(async () => (await paneState()).authority?.write.grant.duration === 'temporary');
    await sendPiMessage('fixture-edit: add a second space in Buy milk.');
    await $('[data-testid="pi-edit-review"]').waitForDisplayed({ timeout: 30_000 });
    for (const layout of ['inline', 'side-by-side']) {
      if (layout === 'side-by-side') {
        await navigateAppTab('Settings');
        await $('[data-settings-section="appearance"]').click();
        await $('label:has(input[name="edit-diff-layout"][value="side-by-side"])').click();
        await navigateAppTab('Gneauxght');
      }
      const changes = await $('[aria-label="Proposed changes"]');
      assert.equal(await changes.getAttribute('data-layout'), layout);
      const text = await changes.getText();
      assert(text.includes('Second project') && !text.includes('First project'));
      assert(text.includes('Spacing or line breaks changed.') && text.includes('··'));
      if (process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT) await $('[data-testid="pi-edit-review"]').saveScreenshot(`${process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT}/pi-spacing-${layout}.png`);
      assert(readFileSync(note.path, 'utf8').includes('Buy milk'));
    }
    await $('button*=Apply edit').click(); await waitPiIdle();
    assert(readFileSync(note.path, 'utf8').includes('Buy  milk'));
    await navigateAppTab('Settings');
    await $('[data-settings-section="appearance"]').click();
    await $('label:has(input[name="edit-diff-layout"][value="inline"])').click();
    await navigateAppTab('Gneauxght');
  });
  it('keeps an intentionally historical citation informational after the agent edit', async () => {
    await edit('Pi historical edited note', true);
    await $('button*=Apply edit').click(); await waitPiIdle();
    await $('[data-pi-source]').click();
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed();
    assert.equal((await paneState()).error, null);
    const notice = await $('[data-testid="pi-source-notice"]');
    assert.equal(await notice.getAttribute('role'), 'status');
    assert((await notice.getText()).includes('changed since the cited read'));
    await $('[aria-label="Dismiss source notice"]').click();
    assert.equal(await notice.isExisting(), false);
    await $('[data-pi-source]').click();
    await $('[data-testid="pi-source-notice"]').waitForExist();
    await newPiConversation();
    assert.equal(await $('[data-testid="pi-source-notice"]').isExisting(), false);
  });
  it('discards and stops reviews without changing the file', async () => {
    const discarded = await edit('Pi discarded model edit'); await $('button*=Discard edit').click(); await waitPiIdle();
    assert(readFileSync(discarded.path, 'utf8').includes('Alpha native editing slice.'));
    await newPiConversation(); const stopped = await edit('Pi stopped model edit'); await $('[data-testid="pi-stop"]').click();
    await browser.waitUntil(async () => !await $('[data-testid="pi-edit-review"]').isExisting());
    assert(readFileSync(stopped.path, 'utf8').includes('Alpha native editing slice.'));
  });
  it('preserves newer canonical content after the reviewed base changes', async () => {
    const note = await edit('Pi stale reviewed model edit');
    await savePiFixtureNote(note.title, 'Alpha native editing slice. New human text.', note.path);
    await $('button*=Apply edit').click(); const pane = await waitPiIdle();
    assert(readFileSync(note.path, 'utf8').includes('New human text.'));
    assert(JSON.stringify(pane.entries).includes('changed_base'));
  });
  it('requires independent write permission and honors explicitly disabled review', async () => {
    const note = await savePiFixtureNote('Pi direct model edit', 'Alpha native editing slice.');
    provider.setEdit({ noteId: note.noteId, oldText: 'Alpha', newText: 'Beta' });
    await sendPiMessage('fixture-edit without write permission'); await waitPiIdle();
    assert(readFileSync(note.path, 'utf8').includes('Alpha native editing slice.'));
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);
    await $('[aria-label="Vault access"]').click(); await $('button*=Allow edits in this chat').click();
    await $('[aria-label="Vault access"]').click(); await $('button*=Review before applying edits').click();
    await browser.waitUntil(async () => (await paneState()).authority?.write.reviewBeforeApplying === false);
    const prompt = 'fixture-edit with direct write permission';
    await sendPiMessage(prompt);
    // The preceding turn is already idle; await this submission's history before
    // using the idle predicate, which otherwise can observe the preceding turn.
    await browser.waitUntil(async () => (await paneState()).entries.some(entry => entry.model?.some(message =>
      message.role === 'user' && JSON.stringify(message.content).includes(prompt))));
    const pane = await waitPiIdle();
    assert(readFileSync(note.path, 'utf8').includes('Beta native editing slice.'));
    assert.equal(await $('[data-testid="pi-edit-review"]').isExisting(), false);
    assert(JSON.stringify(pane.entries).includes('"status":"committed"'));
    // Review is a vault setting; restore the default for following journeys.
    await $('[aria-label="Vault access"]').click(); await $('button*=Review before applying edits').click();
  });
  it('replaces Always with a conversation grant without permission in fresh chats', async () => {
    await $('[aria-label="Vault access"]').click(); await $('button*=Always allow edits').click();
    await browser.waitUntil(async () => (await paneState()).authority?.write.grant.duration === 'always');
    await newPiConversation(); await sendPiMessage('New chat under Always'); await waitPiIdle();
    assert.equal((await paneState()).authority?.write.grant.duration, 'always');
    await $('[aria-label="Vault access"]').click(); await $('button*=Allow edits in this chat').click();
    await browser.waitUntil(async () => (await paneState()).authority?.write.grant.duration === 'temporary');
    await newPiConversation(); await sendPiMessage('New chat after Temporary selection'); await waitPiIdle();
    assert.equal((await paneState()).authority?.write.grant.duration, 'off');
  });
  (process.env.GNEAUX_PI_PROCESS_RESTART === '1' ? it : it.skip)('reopens the same pending review across real process restart and publishes once', async () => {
    const note = await edit('Pi pending review restart'); const id = (await paneState()).conversationId;
    await navigateAppTab('Settings');
    await $('[data-settings-section="appearance"]').click();
    await $('label:has(input[name="edit-diff-layout"][value="side-by-side"])').click();
    if (process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT) await browser.saveScreenshot(`${process.env.GNEAUX_PI_ACCEPTANCE_OUTPUT}/diff-settings.png`);
    await navigateAppTab('Gneauxght');
    await $('[data-testid="pi-edit-before"]').waitForDisplayed();
    assert((await $('[data-testid="pi-edit-before"]').getText()).includes('Alpha native editing slice.'));
    assert((await $('[data-testid="pi-edit-after"]').getText()).includes('Beta native editing slice.'));
    await restartPiFixture();
    if ((await paneState()).conversationId !== id) {
      await $('button[aria-label="Conversations"]').click(); await $(`button[data-conversation-id="${id}"]`).click();
    }
    await $('[data-testid="pi-edit-review"]').waitForDisplayed({ timeout: 30_000 });
    assert.equal(await $('[aria-label="Proposed changes"]').getAttribute('data-layout'), 'side-by-side');
    assert(readFileSync(note.path, 'utf8').includes('Alpha native editing slice.'));
    await $('button*=Apply edit').click(); const pane = await waitPiIdle();
    assert(readFileSync(note.path, 'utf8').includes('Beta native editing slice.'));
    const results = pane.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'edit_note');
    assert.equal(results.length, 1);
    assert(JSON.stringify(results[0]).includes('receiptId'));
    await navigateAppTab('Settings');
    await $('[data-settings-section="appearance"]').click();
    await $('label:has(input[name="edit-diff-layout"][value="inline"])').click();
    await navigateAppTab('Gneauxght');
  });
  it('returns from the edited note to the same single-pane chat without a retained error', async () => {
    const note = await edit('Pi edited note return');
    await $('button*=Apply edit').click();
    const { conversationId } = await waitPiIdle();
    await $('[data-pane-kind="editor"] button[aria-label="Close pane"]').click();
    await browser.waitUntil(async () => !await $('[data-pane-kind="editor"]').isExisting());
    await $('[data-pi-source]').click();
    await $('[data-testid="note-editor"] .cm-content').waitForDisplayed();
    assert((await $('[data-testid="note-editor"] .cm-content').getText()).includes('Beta native editing slice.'));
    assert.equal(await $('[data-testid="pi-chat-panel"]').isExisting(), false);
    await $('[aria-label="Open previous location in this pane"]').click();
    await $('[data-testid="pi-chat-panel"]').waitForDisplayed();
    assert.equal((await paneState()).conversationId, conversationId);
    assert.equal((await paneState()).error, null);
    assert.equal(await $('[aria-label="Dismiss chat error"]').isExisting(), false);
    assert.equal(await $('[data-testid="pi-source-notice"]').isExisting(), false);
    assert(readFileSync(note.path, 'utf8').includes('Beta native editing slice.'));
  });
});

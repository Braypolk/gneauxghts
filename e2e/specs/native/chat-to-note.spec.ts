import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { browser, expect, $, $$ } from '@wdio/globals';
import { invokeNative as invoke } from '../../support/liveNative';
import { nativeE2EPorts } from '../../support/nativeE2EBinary.mjs';

type Proposal = {id: string; status: string; suggestedPath: string; payload: Record<string, unknown>};
type Draft = {version: number; markdown: string; title: string; path: string};
async function editorState() { return browser.execute(() => (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__: {readEditorState: () => {activePaneId: string; editor: {markdown: string; selection: {anchor: number; head: number}} | null}} }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState()); }
async function replaceBody(markdown: string) {
  const before = await browser.execute((text) => {
    document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content')!.focus();
    const bridge = (window as typeof window & {__GNEAUXGHTS_NATIVE_E2E__: {readEditorState: () => {activePaneId: string; editor: {markdown: string; selection: {anchor: number; head: number}}}; setEditorSelection: (a: number, b: number) => boolean}}).__GNEAUXGHTS_NATIVE_E2E__;
    const state = bridge.readEditorState();
    const target = document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content')!;
    const diagnostic = {activePaneId: state.activePaneId, targetPaneId: target.closest('[data-pane-id]')?.getAttribute('data-pane-id'),
      markdown: state.editor.markdown.slice(0, 4096), markdownLength: state.editor.markdown.length, selection: state.editor.selection,
      targetHasFocus: document.activeElement === target, documentHasFocus: document.hasFocus(), visibility: document.visibilityState,
      targetText: target.textContent?.slice(0, 2048)};
    if (!bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length)) throw new Error('Native selection failed');
    if (!document.execCommand('insertText', false, text)) throw new Error('Native text input failed');
    return diagnostic;
  }, markdown);
  // execCommand changes the DOM before CodeMirror's input observer accepts it.
  // A following review action must start after the simulated edit is real.
  try {
    await browser.waitUntil(async () => (await editorState()).editor?.markdown === markdown, {timeoutMsg: 'Native text input did not reach the editor state'});
  } catch (error) {
    const after = await browser.execute(() => {
      const state = (window as typeof window & {__GNEAUXGHTS_NATIVE_E2E__: {readEditorState: () => {activePaneId: string; editor: {markdown: string; selection: {anchor: number; head: number}} | null}}}).__GNEAUXGHTS_NATIVE_E2E__.readEditorState();
      const target = document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content');
      return {activePaneId: state.activePaneId, targetPaneId: target?.closest('[data-pane-id]')?.getAttribute('data-pane-id'),
        markdown: state.editor?.markdown.slice(0, 4096), markdownLength: state.editor?.markdown.length, selection: state.editor?.selection,
        targetHasFocus: document.activeElement === target, documentHasFocus: document.hasFocus(), visibility: document.visibilityState,
        targetText: target?.textContent?.slice(0, 2048)};
    }).catch(() => ({unavailable: true}));
    console.error('NATIVE_REPLACE_BODY_DIAGNOSTIC', JSON.stringify({expected: markdown.slice(0, 4096), expectedLength: markdown.length, before, after}));
    throw error;
  }
}
async function openChat() {
  await $('[data-testid="workspace-card"]').waitForExist({timeout: 30_000});
  await browser.waitUntil(async () => await $('[data-pane-kind="chat"]').isExisting() || await $('button[aria-label="Open thought partner"]').isExisting());
  if (!await $('[data-pane-kind="chat"]').isExisting()) await $('button[aria-label="Open thought partner"]').click();
  await $('[data-pane-kind="chat"] [role="log"]').waitForExist();
}
async function clickSave(messageId: string) {
  await $(`[data-chat-message-id="${messageId}"] button[aria-label="Save to note"]`).click();
  await (await $('[data-proposal-strip="active"]')).$('button=Review next').waitForEnabled();
  await $('[data-pane-kind="editor"] .cm-editor[data-proposal-review="true"]').waitForExist();
}
async function keep() {
  const button = await $('button=Keep All');
  await button.waitForEnabled();
  await button.click();
}

describe('native chat-to-note review', () => {
  async function restartFixture(root: string) {
    const pidForVault = () => execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'}).split('\n').filter(line => line.includes('gneauxghts') && line.includes('--e2e-app-data-root') && line.includes(basename(root))).map(line => Number(line.trim().split(/\s+/)[0]));
    const beforePid = pidForVault()[0];
    expect(beforePid).toBeGreaterThan(0);
    expect((await invoke<{ready: boolean}>('prepare_restart')).ready).toBe(true);
    await browser.execute(() => { setTimeout(() => { void window.__TAURI_INTERNALS__!.invoke('plugin:process|restart', {}); }, 100); });
    await browser.waitUntil(async () => {
      const pid = pidForVault().find(pid => pid !== beforePid);
      if (pid) { writeFileSync(join(root, 'restarted-app.pid'), String(pid)); }
      if (!pid) return false;
      try { const response = await fetch(`http://127.0.0.1:${nativeE2EPorts().driver}/status`); return response.ok && (await response.json() as {value?: {ready?: boolean}}).value?.ready === true; } catch { return false; }
    }, {timeout: 30_000});
    await browser.reloadSession();
    await browser.switchToWindow('main');
    await $('[data-testid="note-editor"] .cm-content').waitForExist({timeout: 30_000});
  }

  let chatId: string;
  let vaultPath: string;
  let linkedDraft: Draft;

  it('checkpoints edited review across restart and publishes exactly once after Keep', async () => {
    await browser.switchToWindow('main');
    await $('[data-testid="note-editor"] .cm-content').waitForExist({timeout: 30_000});
    const vault = await invoke<{runningPath: string}>('get_vault_info');
    vaultPath = vault.runningPath;
    const root = realpathSync(join(vault.runningPath, '..', '..'));
    if (dirname(root) !== realpathSync(tmpdir()) || !basename(root).startsWith('gneauxghts-native-e2e-')) throw new Error('Disposable fixture required');
    const conversation = await invoke<{id: string}>('chat_create_conversation', {request: {title: 'Promotion fixture', access: 'full'}});
    chatId = conversation.id;
    const messageId = 'promotion-native-answer';
    execFileSync('python3', ['-c', `
import contextlib, json, sqlite3, sys
f = json.load(sys.stdin)
with contextlib.closing(sqlite3.connect(f['database'])) as db, db:
    db.execute('INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES (?, ?, 1, ?, ?, ?, 1, 1)', (f['message'], f['conversation'], 'assistant', 'complete', f['content']))
`], {input: JSON.stringify({database: join(vault.runningPath, '.gneauxghts', 'ai.sqlite3'), conversation: conversation.id, message: messageId, content: '# Pilot decision\n\nKeep **the useful detail**.\n\n- One\n- Two'})});
    await openChat();
    await $(`[data-chat-message-id="${messageId}"]`).waitForExist();
    await clickSave(messageId);
    const proposals = await invoke<Proposal[]>('chat_list_pending_proposals', {conversationId: conversation.id});
    expect(proposals.length).toBe(1);
    const id = proposals[0].id;
    const working = '# Pilot decision\n\nKeep **the useful detail**, with my reviewed addition.\n\n- One\n- Two';
    await replaceBody(working);
    const active = (await editorState()).activePaneId;
    await $(`[data-pane-id="${active}"] [data-testid="note-title"]`).setValue('Reviewed pilot');
    await $(`[data-pane-id="${active}"] [data-testid="note-editor"] .cm-content`).click();
    await browser.waitUntil(async () => {
      const draft = await invoke<Draft>('chat_get_proposal_draft', {proposalId: id});
      return draft.markdown.includes('my reviewed addition') && draft.title === 'Reviewed pilot';
    });
    const saved = await invoke<Draft>('chat_get_proposal_draft', {proposalId: id});
    expect(existsSync(saved.path)).toBe(false);
    await restartFixture(root);
    expect(await invoke<Draft>('chat_get_proposal_draft', {proposalId: id})).toEqual(saved);
    if (!await $(`[data-chat-message-id="${messageId}"]`).isExisting()) await openChat();
    await clickSave(messageId);
    await browser.waitUntil(async () => (await editorState()).editor?.markdown === saved.markdown);
    await keep();
    await browser.waitUntil(async () => existsSync(saved.path));
    expect(readFileSync(saved.path, 'utf8')).toContain('my reviewed addition');
    let duplicate: Proposal | undefined;
    await browser.waitUntil(async () => {
      duplicate = await invoke<Proposal>('chat_prepare_note_save', {conversationId: conversation.id, messageId});
      return duplicate.status === 'committed';
    });
    expect(duplicate!.id).toBe(id);
    const receipt = await invoke<{status: string; noteId: string}>('commit_agent_proposal', {proposalId: id, markdown: 'must never overwrite'});
    expect(receipt.status).toBe('committed');
    const history = await invoke<{records: Array<{kind: string; source?: string}>}>('get_note_history_page', {noteId: receipt.noteId, cursor: null, limit: 30});
    expect(history.records.filter(record => record.kind === 'revision').length).toBe(1);
    expect(readFileSync(saved.path, 'utf8')).not.toContain('must never overwrite');
    await $(`[data-chat-message-id="${messageId}"] button[aria-label="Open note"]`).waitForExist();
    const runs = execFileSync('python3', ['-c', 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); print(db.execute("SELECT count(*) FROM chat_agent_runs").fetchone()[0])', join(vault.runningPath, '.gneauxghts', 'ai.sqlite3')], {encoding: 'utf8'});
    expect(Number(runs.trim())).toBe(0);
  });
  async function seed(id: string, ordinal: number, content: string, source?: {noteId: string; path: string; title?: string}) {
    execFileSync('python3', ['-c', `
import contextlib,json,sqlite3,sys
f=json.load(sys.stdin)
with contextlib.closing(sqlite3.connect(f['database'])) as db, db:
    db.execute('INSERT INTO chat_messages(id,conversation_id,ordinal,role,status,content,part,created_at_millis) VALUES(?,?,?,"assistant","complete",?,1,1)',(f['id'],f['chat'],f['ordinal'],f['content']))
    if f.get('source'):
        s=f['source']; p=dict(id='native-proof',noteId=s['noteId'],contentHash='recorded-hash',location='body',start=0,end=6,excerpt='éclair',revisions=[])
        db.execute('INSERT INTO chat_sources(message_id,kind,note_id,note_path,title,excerpt,passage_json) VALUES(?,"passage",?,?,?,"éclair",?)',(f['id'],s['noteId'],s['path'],s.get('title','Evidence source'),json.dumps(p)))
        run=f['id']+'-read-run'
        db.execute('INSERT INTO chat_agent_runs(id,conversation_id,user_message_id,assistant_message_id,provider,model,status,created_at_millis,updated_at_millis) VALUES(?,?,?,?,"local","fixture","complete",1,1)',(run,f['chat'],f['id'],f['id']))
        event=dict(type='toolCallUpdated',callId='read-proof',name='read_notes',title='Read note',status='success',outputSummary='Read note for editing',readSources=[dict(kind='note',noteId=s['noteId'],notePath=s['path'],title=s.get('title','Evidence source'),excerpt='éclair',url=None,anchor=None)])
        db.execute('INSERT INTO chat_agent_events(run_id,sequence,request_id,conversation_id,message_id,event_json,created_at_millis) VALUES(?,1,"fixture-read",?,?,?,1)',(run,f['chat'],f['id'],json.dumps(event)))
`], {input: JSON.stringify({database: join(vaultPath, '.gneauxghts', 'ai.sqlite3'), chat: chatId, id, ordinal, content, source})});
  }
  async function showReview(id: string) {
    if (!await $(`[data-proposal-strip="active"][data-proposal-id="${id}"]`).isExisting()) {
      const button = await (await $(`section[data-proposal-id="${id}"]`)).$('button=Review in editor');
      await button.waitForExist();
      await button.click();
    }
    // The strip also exists during opening, before the target editor is ready.
    // Wait for admitted review actions before focusing or editing its document.
    const strip = await $(`[data-proposal-strip="active"][data-proposal-id="${id}"]`);
    await strip.waitForExist();
    await strip.$('button=Review next').waitForEnabled();
    await $('[data-pane-kind="editor"] .cm-editor[data-proposal-review="true"]').waitForExist();
    await browser.execute(() => document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content')!.focus());
    await browser.waitUntil(async () => !!(await editorState()).editor);
  }
  it('saves the selected repeated Unicode phrase with its outside-highlight source and chat backlink', async () => {
    const source = await invoke<{noteId: string; path: string}>('save_note', {title: 'Evidence source', currentPath: null, markdown: 'Original source content.\n\néclair ^detail'});
    const message = 'promotion-native-selection';
    await seed(message, 2, 'First **éclair**.\n\nSecond **éclair**. [Source 1](passage:native-proof)\n\nUnselected claim.', source);
    await browser.refresh();
    await $('[data-testid="note-editor"] .cm-content').waitForExist({timeout: 30_000});
    await openChat();
    await $(`[data-chat-message-id="${message}"]`).waitForExist();
    await browser.execute((id) => {
      const message = document.querySelector<HTMLElement>(`[data-chat-message-id="${id}"]`)!;
      const text = message.querySelectorAll('strong')[1].firstChild!;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, text.textContent!.length);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      message.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
    }, message);
    await (await $(`[data-chat-message-id="${message}"]`)).$('button=Save to note').click();
    let proposal: (Proposal & {assistantMessageId: string}) | undefined;
    await browser.waitUntil(async () => {
      const proposals = await invoke<Array<Proposal & {assistantMessageId: string}>>('chat_list_pending_proposals', {conversationId: chatId});
      proposal = proposals.find(p => p.assistantMessageId === message);
      return !!proposal;
    });
    if (!proposal) throw new Error('Selection proposal unavailable');
    const draft = await invoke<Draft>('chat_get_proposal_draft', {proposalId: proposal.id});
    expect(draft.markdown).toContain('**éclair** [[Evidence source#^detail|Evidence source]]');
    expect(draft.markdown).toContain('|Open in chat]]');
    expect(draft.markdown).not.toContain('First');
    expect(draft.markdown).not.toContain('Second');
    expect(draft.markdown).not.toContain('Unselected');
    await $(`[data-proposal-strip="active"][data-proposal-id="${proposal.id}"]`).waitForExist();
    await keep();
    await browser.waitUntil(async () => existsSync(draft.path));
    expect(readFileSync(draft.path, 'utf8')).toContain('[[Evidence source#^detail|Evidence source]]');
    await invoke('save_note', {title: 'Evidence source', currentPath: source.path, markdown: 'Source was edited afterwards.\n\nStill éclair here. ^detail'});
    await invoke('finalize_note_editing_window', {noteId: source.noteId});
    await invoke('e2e_flush_vault_watcher_path', {path: source.path});
    expect(readFileSync(draft.path, 'utf8')).toContain('[[Evidence source#^detail|Evidence source]]');
  });
  it('shows the note read in Activity and opens it through the normal note navigation', async () => {
    const conversation = await invoke<{messages: Array<{id: string; agentEvents: Array<{event: {type: string; readSources?: unknown[]}}>}>}>('chat_get_conversation', {conversationId: chatId});
    const read = conversation.messages.find(message => message.id === 'promotion-native-selection')!.agentEvents.find(record => record.event.type === 'toolCallUpdated');
    expect(read!.event.readSources?.length).toBe(1);
    const message = await $('[data-chat-message-id="promotion-native-selection"]');
    await message.$('button[aria-label^="Activity,"]').click();
    const link = await message.$('button[aria-label="Open Evidence source"]');
    await link.waitForDisplayed();
    expect(await link.getText()).toBe('Evidence source');
    expect(await message.$('[aria-label="Notes and passages read"]').getText()).toContain('éclair');
    await link.click();
    await browser.waitUntil(async () => $('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content').getText().then(text => text.includes('Source was edited afterwards.')));
  });

  it('switches edited additions to one target, then refreshes changed canonical content before a second Keep', async () => {
    const target = await invoke<{noteId: string; path: string}>('save_note', {title: 'Destination', currentPath: null, markdown: '# Plan\n\nOriginal.\n\n# Later\n\nUntouched.'});
    await seed('promotion-existing-one', 3, 'First addition.');
    await seed('promotion-existing-two', 4, 'Second addition.');
    const one = await invoke<Proposal>('chat_prepare_note_save', {conversationId: chatId, messageId: 'promotion-existing-one', targetNoteId: target.noteId, heading: 'Plan'});
    const two = await invoke<Proposal>('chat_prepare_note_save', {conversationId: chatId, messageId: 'promotion-existing-two', targetNoteId: target.noteId});
    expect(one.id).not.toBe(two.id);
    await browser.refresh();
    await $('[data-testid="note-editor"] .cm-content').waitForExist({timeout: 30_000});
    await openChat();
    await showReview(one.id);
    const first = await invoke<Draft>('chat_get_proposal_draft', {proposalId: one.id});
    const edited = first.markdown.replace('First addition.', 'First addition, reviewed by me.');
    await replaceBody(edited);
    await showReview(two.id);
    expect((await invoke<Draft>('chat_get_proposal_draft', {proposalId: one.id})).markdown).toBe(edited);
    const second = await invoke<Draft>('chat_get_proposal_draft', {proposalId: two.id});
    await replaceBody(second.markdown.replace('Second addition.', 'Second addition, also edited.'));
    await showReview(one.id);
    expect((await editorState()).editor?.markdown).toBe(edited);
    const beforeOne = await invoke<Draft>('chat_get_proposal_draft', {proposalId: one.id});
    const beforeTwo = await invoke<Draft>('chat_get_proposal_draft', {proposalId: two.id});
    await restartFixture(realpathSync(join(vaultPath, '..', '..')));
    expect(await invoke<Draft>('chat_get_proposal_draft', {proposalId: one.id})).toEqual(beforeOne);
    expect(await invoke<Draft>('chat_get_proposal_draft', {proposalId: two.id})).toEqual(beforeTwo);
    await openChat();
    await showReview(one.id);
    await invoke('save_note', {title: 'Destination', currentPath: target.path, markdown: '# Plan\n\nOriginal.\n\nExternal addition.\n\n# Later\n\nUntouched.'});
    await keep();
    await browser.waitUntil(async () => $('[data-testid="note-editor"] .cm-content').getText().then(text => text.includes('External addition.')));
    expect(readFileSync(target.path, 'utf8')).not.toContain('First addition, reviewed');
    await keep();
    await browser.waitUntil(async () => readFileSync(target.path, 'utf8').includes('First addition, reviewed by me.'));
    expect(readFileSync(target.path, 'utf8')).toContain('External addition.');
    expect(readFileSync(target.path, 'utf8')).toContain('# Later\n\nUntouched.');
    const secondRecovered = await invoke<Draft>('chat_get_proposal_draft', {proposalId: two.id});
    expect(secondRecovered.markdown).toContain('Second addition, also edited.');
    await showReview(two.id);
    await browser.waitUntil(async () => $('[data-testid="note-editor"] .cm-content').getText().then(text => text.includes('Second addition, also edited.')));
    await keep();
    await browser.waitUntil(async () => (await invoke<Draft>('chat_get_proposal_draft', {proposalId: two.id})).markdown.includes('First addition, reviewed'));
    await browser.waitUntil(async () => $('[data-testid="note-editor"] .cm-content').getText().then(text => text.includes('First addition, reviewed')));
    await keep();
    await browser.waitUntil(async () => readFileSync(target.path, 'utf8').includes('Second addition, also edited.'));
    expect(readFileSync(target.path, 'utf8')).toContain('First addition, reviewed by me.');
  });

  it('requires another Keep for a late filename collision and discards a narrow-layout review without publishing', async () => {
    await seed('promotion-collision', 5, '# Collision title\n\nFaithful content with [external URL](https://example.com).\n\n```ts\nconst value = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |');
    const first = await invoke<{path: string}>('save_note', {title: 'Collision title', currentPath: null, markdown: 'Existing bytes'});
    const proposal = await invoke<Proposal>('chat_prepare_note_save', {conversationId: chatId, messageId: 'promotion-collision'});
    const draft = await invoke<Draft>('chat_get_proposal_draft', {proposalId: proposal.id});
    expect(draft.path).not.toBe(first.path);
    expect(draft.markdown).toContain('https://example.com');
    expect(draft.markdown).toContain('const value = 1;');
    expect(draft.markdown).toContain('| 1 | 2 |');
    if (!draft.path.startsWith(vaultPath + '/')) throw new Error('Disposable fixture required');
    writeFileSync(draft.path, 'Late occupied bytes');
    await browser.refresh();
    await $('[data-testid="note-editor"] .cm-content').waitForExist({timeout: 30_000});
    await openChat();
    await showReview(proposal.id);
    await keep();
    let refreshed: Draft | undefined;
    await browser.waitUntil(async () => {
      refreshed = await invoke<Draft>('chat_get_proposal_draft', {proposalId: proposal.id});
      return refreshed.path !== draft.path;
    });
    expect(readFileSync(draft.path, 'utf8')).toContain('Late occupied bytes');
    expect(existsSync(refreshed!.path)).toBe(false);
    await keep();
    await browser.waitUntil(async () => !(await invoke<Proposal[]>('chat_list_pending_proposals', {conversationId: chatId})).some(p => p.id === proposal.id));
    const receipt = await invoke<{applied: {path: string}}>('commit_agent_proposal', {proposalId: proposal.id});
    expect(receipt.applied.path).toBe(refreshed!.path);
    await browser.waitUntil(async () => existsSync(refreshed!.path));
    expect(readFileSync(refreshed!.path, 'utf8')).toContain('Faithful content');
    const discarded = await invoke<Proposal>('chat_prepare_note_save', {conversationId: chatId, messageId: 'promotion-collision', copyIntent: 'narrow-copy'});
    await browser.refresh();
    await $('[data-testid="note-editor"] .cm-content').waitForExist({timeout: 30_000});
    await openChat();
    await showReview(discarded.id);
    const windowSize = await browser.getWindowSize();
    const viewportWidth = await browser.execute(() => innerWidth);
    try {
      await browser.setWindowSize(500, 850);
      expect(await browser.execute(() => innerWidth)).toBeLessThanOrEqual(600);
      const unpublished = await invoke<Draft>('chat_get_proposal_draft', {proposalId: discarded.id});
      await (await $('[data-proposal-strip="active"]')).$('button=Discard').click();
      await browser.waitUntil(async () => !(await invoke<Proposal[]>('chat_list_pending_proposals', {conversationId: chatId})).some(p => p.id === discarded.id));
      expect(existsSync(unpublished.path)).toBe(false);
    } finally {
      // Native window dimensions can differ from CSS pixels on Retina displays.
      // Restore the measured rectangle rather than leaking a narrow viewport.
      await browser.setWindowSize(windowSize.width, windowSize.height);
      await browser.waitUntil(async () => await browser.execute(() => innerWidth) === viewportWidth);
    }
  });

  it('saves a paragraph selected across repeated passage controls without treating their labels as answer text', async () => {
    const message = 'promotion-citation-selection';
    const paragraph = 'The **grocery** note links out to online recipes. Other food-related notes are shopping lists rather than full recipes.';
    const source = await invoke<{noteId: string; path: string}>('save_note', {title: 'grocery', currentPath: null, markdown: 'éclair ^detail'});
    // Recorded sources remain promotable as ordinary links after their live
    // passage proof becomes unavailable. No fabricated source is admitted.
    await seed(message, 7, `Earlier text.\n\n${paragraph} [Source 1](passage:native-proof) [Source 2](passage:native-proof) [Source 3](passage:native-proof)`, {...source, title: 'grocery'});
    await browser.refresh();
    await $('[data-testid="note-editor"] .cm-content').waitForExist({timeout: 30_000});
    await openChat();
    await $(`[data-chat-message-id="${message}"]`).waitForExist();
    await browser.execute((id) => {
      const root = document.querySelector<HTMLElement>(`[data-chat-message-id="${id}"]`)!;
      const paragraph = root.querySelectorAll('.gn-markdown-html p')[1];
      const range = document.createRange(); range.selectNodeContents(paragraph);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
    }, message);
    await (await $(`[data-chat-message-id="${message}"]`)).$('button=Save to note').click();
    let proposal: (Proposal & {assistantMessageId: string}) | undefined;
    await browser.waitUntil(async () => {
      proposal = (await invoke<Array<Proposal & {assistantMessageId: string}>>('chat_list_pending_proposals', {conversationId: chatId})).find(p => p.assistantMessageId === message);
      return !!proposal;
    }, {timeoutMsg: 'Selected paragraph was rejected: ' + await browser.execute(() => document.body.innerText.slice(-1600))});
    const draft = await invoke<Draft>('chat_get_proposal_draft', {proposalId: proposal!.id});
    expect(draft.markdown).toContain(paragraph);
    expect(draft.markdown).not.toContain('[citation unavailable]');
    expect(draft.markdown).toContain('[[grocery#^detail|grocery]]');
    expect(draft.markdown).not.toContain('Earlier text.');
    await (await $('[data-proposal-strip="active"]')).$('button=Discard').click();
  });

  it('opens the chat backlink and source as ordinary links', async () => {
    const message = 'promotion-native-selection';
    await clickSave(message);
    const proposal = (await invoke<Array<Proposal & {assistantMessageId: string}>>('chat_list_pending_proposals', {conversationId: chatId})).find(p => p.assistantMessageId === message && p.payload.wholeAnswer === true)!;
    const draft = await invoke<Draft>('chat_get_proposal_draft', {proposalId: proposal.id});
    await keep();
    await browser.waitUntil(async () => existsSync(draft.path));
    const links = await $$('.gn-wikilink');
    let backlink: WebdriverIO.Element | undefined;
    for (const link of links) if ((await link.getText()).includes('Open in chat')) { backlink = link; break; }
    if (!backlink) throw new Error('Chat backlink was not rendered as an ordinary wikilink');
    await backlink.doubleClick();
    await $(`[data-chat-message-id="${message}"] button[aria-label="Open note"]`).waitForExist();
    await $(`[data-chat-message-id="${message}"] button[aria-label="Open note"]`).click();
    let sourceLink: WebdriverIO.Element | undefined;
    for (const link of await $$('.gn-wikilink')) if ((await link.getText()).includes('Evidence source')) { sourceLink = link; break; }
    if (!sourceLink) throw new Error('Source wikilink unavailable');
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content')!.focus();
      const bridge = (window as typeof window & {__GNEAUXGHTS_NATIVE_E2E__: {readEditorState: () => {editor: {markdown: string}}; setEditorSelection: (a: number,b: number) => boolean}}).__GNEAUXGHTS_NATIVE_E2E__;
      const at = bridge.readEditorState().editor.markdown.indexOf('[[Evidence source') + 3;
      if (at < 3 || !bridge.setEditorSelection(at, at)) throw new Error('Source link selection failed');
      const content = document.querySelector<HTMLElement>('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content')!;
      const handled = !content.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true, bubbles: true, cancelable: true}));
      if (!handled) throw new Error('Ordinary wikilink keymap did not handle Cmd+Enter');
    });
    await browser.waitUntil(async () => $('[data-testid="note-editor"] .cm-content').getText().then(text => text.includes('Source was edited afterwards.')));
    linkedDraft = draft;
  });

  // Native WebKit suspends animation frames when its window is hidden/occluded.
  // Keep the actual painted cursor assertion explicit, rather than simulating frames.
  (process.env.GNEAUXGHTS_E2E_FOREGROUND === '1' ? it : it.skip)('positions the cursor at the preserved source block after native paint', async () => {
    await browser.waitUntil(async () => {
      const editor = (await editorState()).editor;
      return !!editor && editor.markdown.includes('Still éclair here.') &&
        editor.selection.anchor >= editor.markdown.indexOf('Still éclair here.');
    });
  });

  it('keeps the saved content and block link after chat deletion', async () => {
    const draft = linkedDraft;
    const savedBytes = readFileSync(draft.path, 'utf8');
    const forgotten = await invoke<{forgottenPath: string}>('chat_archive_conversation', {conversationId: chatId, archived: true, retentionDays: 30});
    await invoke('delete_forgotten_notes', {forgottenPaths: [forgotten.forgottenPath]});
    expect(readFileSync(draft.path, 'utf8')).toBe(savedBytes);
    expect(savedBytes).toContain('[[Evidence source#^detail|Evidence source]]');
    expect(savedBytes).toContain('|Open in chat]]');
    const resolved = await invoke<{notePath: string; blockId: string; matchText: string}>('resolve_note_link', {rawTarget: 'Evidence source#^detail|Evidence source', currentPath: draft.path, currentTitle: draft.title, currentMarkdown: null, currentBodyHash: null});
    expect(resolved.blockId).toBe('detail');
    expect(resolved.matchText).toBe('Still éclair here. ^detail');
    expect(readFileSync(resolved.notePath, 'utf8')).toContain('Source was edited afterwards.');
  });

});

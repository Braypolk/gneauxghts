// Synthetic iOS gate only. The native process driver supplies a new challenge
// after each exact owned-process CONT; visibility events are not evidence.
import type { ChatProposalDraft } from '$lib/features/chat/types';
import type { ChatApi } from '$lib/features/chat/api';
import type { EditorView } from '@codemirror/view';

export type SuspensionSnapshot = {
  ordinary: { noteId: string | null; path: string | null; title: string; markdown: string; connected: boolean };
  review: { proposalId: string; reviewId: string; draft: ChatProposalDraft; connected: boolean; markdown: string; title: string; hunks: ChatProposalDraft['decisions'] };
  partial: { conversationId: string; messageId: string; content: string; status: string; renderedPartial: boolean; normalControl: string };
};
type Command = { stage: 'foreground' | 'lease-continue'; launchId: string; nonce: string; issuedAt: number };
type ProbeApi = {
  getSettings(): Promise<{ localBaseUrl?: string | null }>;
  prototypeState(): Promise<{ supplementalSuspensionStateJson?: string } | undefined>;
  prototypeCheckpoint(value: unknown): Promise<void>;
};
export type SuspensionOrdinary = Omit<SuspensionSnapshot['ordinary'], 'connected'> & { sourceMessageId?: string; conversationId?: string };
type Ordinary = SuspensionOrdinary;
type UiUntil = <T>(read: () => T | Promise<T>, label: string) => Promise<NonNullable<T>>;
export type SuspensionInteractiveState = { a: string; keepId?: string; interruptedId?: string; supplementalOrdinary?: Ordinary };

/** Seed a separate ordinary note, then author its final bytes through CodeMirror. */
export async function prepareSupplementalOrdinary(input: { openOrdinary(note: Ordinary): Promise<EditorView>; until: UiUntil }) {
  const { invoke } = await import('@tauri-apps/api/core');
  const title = `Pi suspension ordinary ${crypto.randomUUID()}`;
  const seeded = await invoke<Ordinary>('save_note', { title, markdown: 'Synthetic ordinary suspension seed.\n', currentPath: null });
  assert(seeded.noteId && seeded.path, 'Synthetic ordinary note lacks canonical identity');
  const view = await input.openOrdinary(seeded);
  const markdown = `${view.state.doc.toString()}\nAuthored in the ordinary CodeMirror editor before suspension.\n`;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown }, userEvent: 'input.type' });
  const acknowledged = await input.until(async () => {
    const note = await invoke<Ordinary>('read_note', { noteId: seeded.noteId, path: seeded.path });
    return note.noteId === seeded.noteId && note.path === seeded.path && note.markdown === markdown ? note : undefined;
  }, 'ordinary authored bytes acknowledged by canonical native read');
  return { noteId: acknowledged.noteId, path: acknowledged.path, title: acknowledged.title, markdown: acknowledged.markdown };
}

/** Borrow normal workspace navigation; never infer state from body text alone. */
export async function captureSupplementalSuspensionUi(input: {
  api: Pick<ChatApi, 'getConversation' | 'listPendingProposals' | 'getProposalDraft'>;
  state: SuspensionInteractiveState; until: UiUntil;
  openOrdinary(note: Ordinary): Promise<EditorView>;
  openReview(id: string, reviewId: string): Promise<EditorView>;
  selectConversation(id: string): Promise<void>;
}): Promise<SuspensionSnapshot> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { reviewProjection } = await import('$lib/features/proposals/reviewExtension');
  const { probePaneTitle } = await import('./probePaneTitle');
  const { visibleProbeControl } = await import('./probeChatFocus');
  const { state, api } = input;
  assert(state.supplementalOrdinary && state.keepId && state.interruptedId, 'Supplemental ordinary/review/partial setup is missing');
  const ordinaryView = await input.openOrdinary(state.supplementalOrdinary);
  const ordinaryCanonical = await invoke<Ordinary>('read_note', { noteId: state.supplementalOrdinary.noteId, path: state.supplementalOrdinary.path });
  assert(same(ordinaryCanonical.markdown, state.supplementalOrdinary.markdown), 'Canonical ordinary bytes differ from authored baseline');
  const ordinary = { noteId: ordinaryCanonical.noteId, path: ordinaryCanonical.path,
    title: probePaneTitle(ordinaryView.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value ?? '',
    markdown: ordinaryView.state.doc.toString(), connected: ordinaryView.dom.isConnected };
  const pending = (await api.listPendingProposals(state.a)).find(value => value.id === state.keepId);
  const reviewId = pending?.preview.reviewId;
  assert(typeof reviewId === 'string' && reviewId.length > 0, 'Exact pending review identity is absent');
  const reviewView = await input.openReview(state.keepId, reviewId);
  const draft = await api.getProposalDraft!(state.keepId), projection = reviewView.state.field(reviewProjection, false);
  assert(projection?.reviewId === reviewId, 'Mounted review identity differs from pending review');
  const review = { proposalId: state.keepId, reviewId, draft, connected: reviewView.dom.isConnected,
    markdown: reviewView.state.doc.toString(), title: probePaneTitle(reviewView.dom.closest<HTMLElement>('[data-testid="workspace-pane"]'), 'editor')?.value ?? '',
    hunks: structuredClone(projection.hunks) };
  // The existing picker helper exercises a normal enabled Conversations control.
  await input.selectConversation(state.a);
  const message = (await api.getConversation(state.a)).messages.find(value => value.id === state.interruptedId);
  assert(message && message.content === 'Acknowledged partial fixture text.', 'Exact acknowledged interrupted partial is absent');
  const row = await input.until(() => document.querySelector<HTMLElement>(`[data-chat-message-id="${state.interruptedId}"]`), 'current interrupted message row');
  const controlRoot = message.status === 'streaming' ? document : row;
  const controlLabel = message.status === 'streaming' ? 'Stop response' : 'Retry';
  const normalControl = await input.until(() => Array.from(controlRoot.querySelectorAll<HTMLButtonElement>('button')).find(node => !node.disabled && visibleProbeControl(node) &&
    (node.getAttribute('aria-label') ?? node.textContent?.trim()) === controlLabel), 'normal interrupted Stop/Retry control');
  return { ordinary, review, partial: { conversationId: state.a, messageId: message.id, status: message.status, content: message.content,
    renderedPartial: row.isConnected && visibleProbeControl(row) && Boolean(row.textContent?.includes(message.content)),
    normalControl: normalControl.getAttribute('aria-label') ?? normalControl.textContent!.trim() } };
}
export type SuspensionSqlRequest = { action: 'open' | 'close' | 'begin' | 'commit' | 'rollback' | 'exec' | 'run' | 'get'; owner?: number; transaction?: number; sql?: string };
export type SuspensionSql = <T = unknown>(request: SuspensionSqlRequest) => Promise<T>;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function suspensionControlOrigin(endpoint: string | null | undefined) {
  assert(endpoint, 'Suspension gate requires the explicit fixture endpoint');
  const url = new URL(endpoint);
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && !url.search && !url.hash,
    'Suspension control requires an explicit IPv4 loopback HTTP fixture');
  assert(url.port === '1443' || url.port === '1446', 'Suspension control requires an owned fixture port');
  return `http://127.0.0.1:${Number(url.port) + 1}`;
}

export function assertSuspensionSnapshot(expected: SuspensionSnapshot, actual: SuspensionSnapshot, phase: 'foreground' | 'relaunch') {
  assert(expected.ordinary.noteId && expected.ordinary.path && actual.ordinary.connected, 'Ordinary authored editor is not connected or lacks canonical identity');
  assert(same(expected.ordinary, actual.ordinary), 'Suspension changed exact ordinary identity/path/title/editor bytes');
  assert(expected.review.proposalId && expected.review.reviewId && actual.review.connected, 'Pending review identity or connected editor is absent');
  assert(same(expected.review, actual.review), 'Suspension changed exact pending review identity/version/body/title/location/hunks');
  assert(actual.review.markdown === actual.review.draft.markdown && actual.review.title === actual.review.draft.title && same(actual.review.hunks, actual.review.draft.decisions),
    'Mounted pending review differs from acknowledged full checkpoint');
  assert(actual.partial.conversationId === expected.partial.conversationId && actual.partial.messageId === expected.partial.messageId && actual.partial.content === expected.partial.content,
    'Suspension changed interrupted message identity or acknowledged partial bytes');
  assert(actual.partial.renderedPartial && actual.partial.normalControl === (phase === 'foreground' ? 'Stop response' : 'Retry'), 'Fresh interrupted partial or normal control is absent');
  assert(phase === 'foreground' ? actual.partial.status === expected.partial.status && actual.partial.status === 'streaming'
    : ['error', 'cancelled'].includes(actual.partial.status), 'Interrupted partial has an unexpected foreground/relaunch status');
}

async function mustReject(operation: () => Promise<unknown>, label: string) {
  try { await operation(); } catch (error) { return String(error); }
  throw new Error(`${label} was incorrectly acknowledged`);
}

/** No chat reads may run after arm: opening a native owner revokes its predecessor. */
export async function armSuspensionLease(sql: SuspensionSql, now = Date.now) {
  const owner = await sql<number>({ action: 'open' });
  try {
    await sql({ action: 'exec', owner, sql: 'CREATE TABLE IF NOT EXISTS pi_suspension_lease(value TEXT); DELETE FROM pi_suspension_lease;' });
    const transaction = await sql<number>({ action: 'begin', owner });
    await sql({ action: 'run', owner, transaction, sql: "INSERT INTO pi_suspension_lease VALUES ('uncommitted across owned STOP')" });
    return { owner, transaction, armedAt: now(), uncommittedRows: 1 };
  } catch (error) { await sql({ action: 'close', owner }); throw error; }
}

export async function finishSuspensionLease(sql: SuspensionSql, armed: Awaited<ReturnType<typeof armSuspensionLease>>, now = Date.now) {
  let owner = armed.owner;
  try {
    assert(now() - armed.armedAt > 12000, 'Suspended transaction did not exceed its ten-second native lease');
    const commitError = await mustReject(() => sql({ action: 'commit', owner, transaction: armed.transaction }), 'Suspended lease COMMIT');
    assert(/revoked|expired/i.test(commitError), 'Suspended transaction failed without lease revocation/expiry evidence');
    owner = await sql<number>({ action: 'open' });
    const staleOwnerError = await mustReject(() => sql({ action: 'commit', owner: armed.owner, transaction: armed.transaction }), 'Stale suspended owner COMMIT after reopen');
    assert(/revoked/i.test(staleOwnerError), 'Explicit reopen did not reject the stale suspended owner');
    const rejectedDurableRows = (await sql<{ count: number }>({ action: 'get', owner, sql: 'SELECT count(*) AS count FROM pi_suspension_lease' })).count;
    assert(rejectedDurableRows === 0, 'Suspended native transaction leaked durable rows');
    await sql({ action: 'run', owner, sql: "INSERT INTO pi_suspension_lease VALUES ('fresh owner committed')" });
    const freshOwnerRows = (await sql<{ count: number }>({ action: 'get', owner, sql: 'SELECT count(*) AS count FROM pi_suspension_lease' })).count;
    assert(freshOwnerRows === 1, 'Fresh native owner could not commit after suspended lease');
    return { ...armed, rejectedAt: now(), commitError, staleOwnerError, rejectedDurableRows, freshOwnerRows, status: 'passed' };
  } finally {
    // Reopen deliberately before cleanup, including a failed late COMMIT path.
    const cleanupOwner = await sql<number>({ action: 'open' });
    try { await sql({ action: 'exec', owner: cleanupOwner, sql: 'DROP TABLE IF EXISTS pi_suspension_lease;' }); }
    finally { await sql({ action: 'close', owner: cleanupOwner }); }
  }
}

async function controlRequest<T>(origin: string, path: string, value?: unknown): Promise<T> {
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 1500);
  try {
    const response = await fetch(`${origin}/pi-suspension/${path}`, { cache: 'no-store', signal: timeout.signal,
      ...(value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) });
    assert(response.ok, 'Owned iOS suspension control rejected request'); return await response.json() as T;
  } finally { clearTimeout(timer); }
}

async function waitCommand(origin: string, launchId: string, stage: Command['stage']) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const command = await controlRequest<Command | null>(origin, `command?launchId=${encodeURIComponent(launchId)}&stage=${stage}`);
    if (command) {
      assert(command.launchId === launchId && command.stage === stage && typeof command.nonce === 'string' && command.nonce.length >= 16 && Number.isFinite(command.issuedAt), 'Invalid fresh suspension challenge');
      return command;
    }
    await sleep(100);
  }
  throw new Error(`Fresh owned-process ${stage} challenge was not issued`);
}

/** Invoke after shared FIRST has persisted, before ending the first launch. */
export async function runSupplementalSuspensionProbe(input: {
  api: ProbeApi; launchId: string; capture(): Promise<SuspensionSnapshot>;
  emit(value: Record<string, unknown>): Promise<void>;
}) {
  const { invoke } = await import('@tauri-apps/api/core');
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean }>('pi_probe_config');
  assert(config.fixture && config.interactiveGate && config.expandedGate, 'Suspension probe requires explicit expanded synthetic gates');
  const origin = suspensionControlOrigin((await input.api.getSettings()).localBaseUrl);
  // Desktop expanded gates have no owned iOS control server and skip this lane.
  let discovery: { gate: string; launchId: string };
  try { discovery = await controlRequest(origin, `discover?launchId=${encodeURIComponent(input.launchId)}`); }
  catch { return undefined; }
  assert(discovery.gate === 'owned-ios-suspension-control' && discovery.launchId === input.launchId, 'Unrecognized iOS suspension control owner');
  const baseline = await input.capture();
  assertSuspensionSnapshot(baseline, baseline, 'foreground');
  await input.api.prototypeCheckpoint({ supplementalSuspensionStateJson: JSON.stringify({ launchId: input.launchId, baseline }) });
  await input.emit({ status: 'ready', baseline, launchId: input.launchId });
  const foregroundCommand = await waitCommand(origin, input.launchId, 'foreground');
  const foreground = await input.capture();
  assertSuspensionSnapshot(baseline, foreground, 'foreground');
  const freshReadAt = Date.now();
  const foregroundAck = await controlRequest(origin, 'ack', foregroundCommand);
  await input.emit({ status: 'foreground-passed', launchId: input.launchId, baseline, foreground, foregroundCommand, foregroundAck, freshReadAt });
  const { closePiChatApis } = await import('./chatApi');
  await closePiChatApis();
  const sql: SuspensionSql = request => invoke('pi_sql', { request });
  const armed = await armSuspensionLease(sql);
  try {
    await input.emit({ status: 'lease-ready', launchId: input.launchId, baseline, foreground, foregroundCommand, foregroundAck, freshReadAt, armed });
    const leaseCommand = await waitCommand(origin, input.launchId, 'lease-continue');
    const lease = await finishSuspensionLease(sql, armed);
    const leaseAck = await controlRequest(origin, 'ack', leaseCommand);
    const result = { status: 'passed', launchId: input.launchId, baseline, foreground, foregroundCommand, foregroundAck, freshReadAt, leaseCommand, leaseAck, lease };
    await input.emit(result); return result;
  } catch (error) {
    // A challenge timeout or report failure must also relinquish the armed owner.
    const owner = await sql<number>({ action: 'open' });
    try { await sql({ action: 'exec', owner, sql: 'DROP TABLE IF EXISTS pi_suspension_lease;' }); }
    finally { await sql({ action: 'close', owner }); }
    throw error;
  }
}

/** Run before shared relaunch Keep/Discard/Retry changes any retained state. */
export async function verifySupplementalSuspensionRelaunch(input: { api: ProbeApi; capture(): Promise<SuspensionSnapshot> }) {
  const json = (await input.api.prototypeState())?.supplementalSuspensionStateJson;
  if (!json) return undefined;
  const expected = JSON.parse(json) as { launchId: string; baseline: SuspensionSnapshot };
  const restored = await input.capture(); assertSuspensionSnapshot(expected.baseline, restored, 'relaunch');
  return { status: 'passed', priorLaunchId: expected.launchId, restored, freshReadAt: Date.now() };
}

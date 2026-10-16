// Opt-in synthetic provider plans. All reads, policy, cancellation and durable
// answer admission remain with the native application and Pi tasks.
export const SUPPLEMENTAL_EVIDENCE_CONTROL_PATH = '/__pi_supplemental_evidence';
const pattern = /PI_SUPPLEMENTAL:([A-Z_]+):([A-Za-z0-9_-]+)(?::([A-Za-z0-9_-]+))?/;
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => part.text ?? '').join('') : '';
const objects = value => value && typeof value === 'object' ? [value, ...Object.values(value).flatMap(objects)] : [];
const historyOf = (body, compatible) => compatible ? body.messages : body.input;
const decode = value => { try { return JSON.parse(textOf(value)); } catch { return undefined; } };
const pathOf = protocol => protocol === 'local' ? '/local/v1/chat/completions' : '/openai/v1/responses';

export function planSupplementalEvidenceReply(body, compatible) {
  const history = historyOf(body, compatible);
  if (!Array.isArray(history)) return undefined;
  const last = history.findLastIndex(item => item.role === 'user');
  const marker = textOf(history[last]?.content).match(pattern);
  if (!marker) return undefined;
  const [, action, run, noteId] = marker;
  const outputs = history.slice(last + 1).filter(item => item.role === 'tool' || item.type === 'function_call_output');
  const delivered = outputs.flatMap(item => objects(decode(item.output ?? item.content)));
  const source = delivered.find(item => typeof item.sourceId === 'string' && item.noteId === noteId && item.location === 'body')
    ?? delivered.find(item => typeof item.sourceId === 'string' && item.noteId === noteId);
  const reply = value => ({ journey: `SUPPLEMENTAL_${action}`, run, ...value });
  const tool = (name, args) => reply({ tool: { name, arguments: JSON.stringify(args) } });
  if (action === 'WARMUP') return reply({ text: 'Synthetic supplemental warmup completed.' });
  if (['EDIT', 'RENAME', 'EXCLUDE'].includes(action)) {
    if (!outputs.length) return tool('read_note', { noteId });
    if (!source) throw new Error('Supplemental race has no actually delivered source for its exact note');
    return reply({ text: JSON.stringify({ segments: [{ text: `Synthetic supplemental grounded answer ${run}.`, sources: [source.sourceId] }] }), barrier: `${run}:${action}` });
  }
  if (action === 'STOP_RESEARCH' || action === 'NEW_RESEARCH') {
    if (!outputs.length) return tool('research_notes', { question: `PI_SUPPLEMENTAL:${action === 'STOP_RESEARCH' ? 'STOP_WORKER' : 'NEW_WORKER'}:${run}:${noteId}`, note_ids: [noteId], timeout_ms: 120000 });
    if (!source) throw new Error('Supplemental parent has no actually delivered research source');
    return reply({ text: JSON.stringify({ segments: [{ text: `Synthetic supplemental research answer ${run}.`, sources: [source.sourceId] }] }) });
  }
  if (action === 'STOP_WORKER' || action === 'NEW_WORKER') {
    const tools = (body.tools ?? []).map(item => item.function?.name ?? item.name ?? item.type);
    if (!tools.length || tools.some(name => !['find_notes', 'read_notes', 'list_note_activity'].includes(name))) throw new Error('Supplemental worker inherited parent or web capabilities');
    if (!outputs.length) return tool('read_notes', { note_id: noteId });
    const evidence = delivered.find(item => item.noteId === noteId && typeof item.evidenceId === 'string' && typeof item.sourceId === 'string');
    if (!evidence) throw new Error('Supplemental worker cannot select unread or another note evidence');
    return reply({ text: JSON.stringify({ evidence_ids: [evidence.evidenceId], gaps: [] }), ...(action === 'STOP_WORKER' ? { barrier: `${run}:STOP_WORKER` } : {}) });
  }
  throw new Error(`Unknown supplemental evidence action ${action}`);
}

/** Deliberate after-text barrier, never a timer guessed to overlap inference.
 * The server calls hold only after sending the full draft/worker selection.
 * Cancellation closes that actual HTTP response; releasing later cannot revive it.
 */
export function createSupplementalEvidenceControl() {
  const barriers = new Map();
  const snapshot = () => [...barriers.values()].map(({ resolve, record, ...value }) => ({ ...value,
    completed: record.completed === true, firstTextAt: record.firstTextAt ?? null }));
  return {
    snapshot,
    async hold(barrier, record, res) {
      if (typeof barrier !== 'string' || !/^[A-Za-z0-9_-]+:(EDIT|RENAME|EXCLUDE|STOP_WORKER)$/.test(barrier)) throw new Error('Invalid supplemental barrier');
      if (barriers.has(barrier)) throw new Error('Duplicate supplemental inference barrier');
      if (!Number.isFinite(record.firstTextAt)) throw new Error('Supplemental barrier must follow actual streamed text');
      let resolve;
      const released = new Promise(done => { resolve = done; });
      const entry = { barrier, heldAt: Date.now(), releasedAt: null, closedAt: null, closedBeforeRelease: false, record, resolve };
      barriers.set(barrier, entry); record.supplementalBarrier = barrier;
      record.supplementalHeldAt = entry.heldAt;
      const closed = () => { entry.closedAt = Date.now(); entry.closedBeforeRelease = entry.releasedAt === null;
        record.supplementalClosedBeforeRelease = entry.closedBeforeRelease; resolve(); };
      res.once('close', closed);
      if (res.destroyed) closed();
      await released;
      res.removeListener('close', closed);
    },
    async handle(req, res) {
      if (req.url !== SUPPLEMENTAL_EVIDENCE_CONTROL_PATH) return false;
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json', 'cache-control': 'no-store' };
      try {
        if (req.headers.authorization || req.headers.cookie) throw new Error('Supplemental control must never receive credentials');
        if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return true; }
        if (req.method === 'GET') { res.writeHead(200, headers); res.end(JSON.stringify({ barriers: snapshot() })); return true; }
        if (req.method !== 'POST') throw new Error('Unsupported supplemental control method');
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2048) throw new Error('Oversize supplemental control'); }
        const body = JSON.parse(raw);
        if (Object.keys(body).sort().join(',') !== 'action,barrier' || body.action !== 'release') throw new Error('Invalid supplemental control action');
        const entry = barriers.get(body.barrier);
        if (!entry) throw new Error('Unknown supplemental barrier');
        if (entry.releasedAt !== null) throw new Error('Supplemental barrier already released');
        entry.releasedAt = Date.now(); entry.record.supplementalReleasedAt = entry.releasedAt; entry.resolve();
        res.writeHead(200, headers); res.end(JSON.stringify({ barriers: snapshot() }));
      } catch (error) { res.writeHead(400, headers); res.end(JSON.stringify({ error: String(error) })); }
      return true;
    },
  };
}

/** Exact wire accounting complements the public API/UI receipts. */
export function verifySupplementalEvidenceReceipts(requests, report) {
  if (report?.gate !== 'supplemental-native-evidence-fixture' || report.status !== 'passed' || !report.run) throw new Error('Supplemental native evidence report did not pass');
  const verified = [];
  for (const protocol of ['local', 'openai']) {
    const cases = report.receipts?.[protocol];
    if (!cases) throw new Error(`Missing ${protocol} supplemental public receipts`);
    // Interactive records historically omit planner run metadata. Bind through
    // the original user marker instead of any previous turn or worker question.
    const owned = requests.filter(record => {
      // Inspect either wire shape so an incorrectly routed request cannot hide
      // outside the expected protocol bucket, even if planning threw early.
      const history = record.body?.messages ?? record.body?.input;
      const marker = textOf(history?.findLast(item => item.role === 'user')?.content).match(pattern);
      return marker?.[2] === `${report.run}_${protocol}`;
    });
    const expected = { WARMUP: 1, EDIT: 2, RENAME: 2, EXCLUDE: 2, STOP_RESEARCH: 1, STOP_WORKER: 2, NEW_RESEARCH: 2, NEW_WORKER: 2 };
    if (owned.length !== Object.values(expected).reduce((sum, count) => sum + count, 0)
      || owned.some(record => record.error || record.path !== pathOf(protocol) || !record.journey?.startsWith('SUPPLEMENTAL_'))) throw new Error(`Unexpected ${protocol} supplemental provider request count/error/routing`);
    for (const [action, count] of Object.entries(expected)) {
      const actual = owned.filter(record => record.journey === `SUPPLEMENTAL_${action}`);
      if (actual.length !== count) throw new Error(`Unexpected ${protocol} ${action} attempts`);
      if (action === 'STOP_WORKER') {
        if (!actual[0].completed || actual[0].tool !== 'read_notes' || actual[1].completed || !actual[1].closed || !actual[1].supplementalClosedBeforeRelease) throw new Error(`${protocol} active research transport did not terminate before release`);
      } else if (action === 'EXCLUDE') {
        // Revocation can abort the held response before its terminal frames.
        if (!actual[0].completed || !actual[1].supplementalBarrier || !actual[1].supplementalReleasedAt) throw new Error(`${protocol} excluded inference did not cross the controlled race`);
      } else if (actual.some(record => !record.completed)) throw new Error(`Missing ${protocol} ${action} native completion`);
    }
    for (const action of ['EDIT', 'RENAME', 'EXCLUDE']) {
      const receipt = cases[action.toLowerCase()];
      const final = owned.find(record => record.journey === `SUPPLEMENTAL_${action}` && record.supplementalBarrier);
      if (!receipt || !receipt.noProvisional || !(final.firstTextAt <= final.supplementalHeldAt && final.supplementalHeldAt <= receipt.mutatedAt && receipt.mutatedAt <= final.supplementalReleasedAt)) throw new Error(`${protocol} ${action} lacks ordered after-read mutation proof`);
    }
    const stopped = cases.stop;
    const worker = owned.find(record => record.journey === 'SUPPLEMENTAL_STOP_WORKER' && record.supplementalBarrier);
    const freshWorkers = owned.filter(record => record.journey === 'SUPPLEMENTAL_NEW_WORKER');
    if (!stopped || !stopped.noLateEvidence || !stopped.newResearchCompleted || !(worker.supplementalHeldAt <= stopped.stopClickedAt && stopped.stopClickedAt <= worker.closedAt
      && worker.closedAt <= worker.supplementalReleasedAt)
      || freshWorkers.some(record => record.startedAt < worker.supplementalReleasedAt || JSON.stringify(record.body).includes(stopped.stoppedNoteId)
        || JSON.stringify(record.body).includes(`PI_SUPPLEMENTAL:STOP_WORKER:${report.run}_${protocol}`))) throw new Error(`${protocol} worker cancellation/admission isolation proof missing`);
    verified.push(`${protocol}: three after-read source races and active research Stop/new admission, 14 exact provider requests`);
  }
  return verified;
}

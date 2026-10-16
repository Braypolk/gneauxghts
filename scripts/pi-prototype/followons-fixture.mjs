// Opt-in provider behavior only. Native evidence, admission, Pi tasks and
// compaction policy remain the application owners, including in this fixture.
const markerPattern = /PI_FOLLOWONS:([A-Z_]+):([A-Za-z0-9_-]+)(?::([A-Za-z0-9_,-]+))?/;
const objects = value => value && typeof value === 'object' ? [value, ...Object.values(value).flatMap(objects)] : [];
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => part.text ?? '').join('') : '';
const parse = text => { try { return JSON.parse(text); } catch { return undefined; } };
// Real Pi markers wrap JSON in <summary>, and serialized summary source can
// contain a progress object followed by more transcript text. Decode exactly
// one object while respecting quoted braces and escapes.
function objectPrefix(text, start) {
  if (text[start] !== '{') return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return parse(text.slice(start, index + 1));
  }
}
function historyOf(body, compatible) { return compatible ? body.messages : body.input; }
function expandedObjects(value) {
  const result = objects(value);
  for (const item of [...result]) for (const child of Object.values(item)) {
    if (typeof child === 'string') {
      const envelope = child.indexOf('\n{');
      const decoded = parse(child) ?? (envelope >= 0 ? objectPrefix(child, envelope + 1) : undefined);
      if (decoded) result.push(...objects(decoded));
    }
  }
  return result;
}
function progress(history) {
  const values = expandedObjects(history);
  const completed = new Set(), evidence = new Set();
  for (const item of values) {
    for (const text of Object.values(item).filter(value => typeof value === 'string'))
      for (const match of text.matchAll(/FOLLOWONS_PROGRESS:/g)) {
        const saved = objectPrefix(text, match.index + match[0].length);
        for (const id of saved?.completed ?? []) completed.add(id);
        for (const id of saved?.evidence ?? []) evidence.add(id);
      }
    if (typeof item.evidenceId === 'string' && typeof item.sourceId === 'string') {
      evidence.add(item.evidenceId);
      if (typeof item.noteId === 'string') completed.add(item.noteId);
    }
  }
  return { completed: [...completed], evidence: [...evidence] };
}

export function planFollowonsReply(body, compatible, attempt = 1) {
  const history = historyOf(body, compatible);
  if (!Array.isArray(history)) return undefined;
  const system = `${body.instructions ?? ''}\n${history.filter(item => ['system', 'developer'].includes(item.role)).map(item => textOf(item.content)).join('\n')}`;
  const lastUser = history.findLastIndex(item => item.role === 'user');
  const prompt = textOf(history[lastUser]?.content);
  const summary = system.includes('Compact the supplied transcript into a continuation summary.');
  // A parent transcript may contain a worker marker inside a previous tool
  // argument. The preserved original request determines summary ownership.
  const original = summary ? prompt.split('Original request (retain its requirements):\n').at(-1) : prompt;
  const marker = original?.match(markerPattern);
  if (!marker) return undefined;
  const [, action, run, idsCsv] = marker;
  const ids = idsCsv?.split(',').filter(Boolean) ?? [];
  const journey = `FOLLOWONS_${summary ? `SUMMARY_${action === 'WORKER' ? 'WORKER' : 'PARENT'}` : action}`;
  // This synthetic tokenizer charges one input token per serialized byte.
  // The production policy still decides when/what to compact and validates
  // real bounded summary reduction. No forced-compaction escape is used.
  const usageInput = Buffer.byteLength(JSON.stringify(body));
  const reply = value => ({ journey, run, usageInput, usageOutput: 8, ...value });
  const tool = (name, args) => reply({ tool: { name, arguments: JSON.stringify(args) } });
  if (summary) {
    if ((body.tools ?? []).length) throw new Error('Summary inference received tools');
    const transcript = prompt.split('</transcript>')[0];
    const remembered = progress(history);
    // Tool result JSON lives inside the serialized summary source text.
    const evidence = [...remembered.evidence, ...[...transcript.matchAll(/"evidenceId"\s*:\s*"([^"]+)"/g)].map(match => match[1])];
    const completed = [...remembered.completed, ...[...transcript.matchAll(/"noteId"\s*:\s*"([^"]+)"/g)].map(match => match[1])];
    const saved = { completed: [...new Set(completed)], evidence: [...new Set(evidence)].slice(-3) };
    return reply({ text: JSON.stringify({ summary: `Synthetic continuation; original request remains authoritative. FOLLOWONS_PROGRESS:${JSON.stringify(saved)}` }) });
  }
  const tail = history.slice(lastUser + 1);
  const outputs = tail.filter(item => item.role === 'tool' || item.type === 'function_call_output');
  const delivered = outputs.flatMap(item => expandedObjects(parse(textOf(item.output ?? item.content))));
  const source = delivered.find(item => typeof item?.sourceId === 'string' && item.location === 'body') ?? delivered.find(item => typeof item?.sourceId === 'string');
  const sourced = suffix => {
    if (!source) throw new Error(`No native-delivered source for ${action}`);
    return reply({ text: JSON.stringify({ segments: [{ text: `Synthetic follow-on canonical evidence${suffix ?? ''}`, sources: [source.sourceId] }] }) });
  };
  if (action === 'WARMUP') return reply({ text: `Synthetic warmup ${run}. ${'Continuation background. '.repeat(730)}` });
  if (action === 'PARENT') return reply({ text: 'Synthetic parent continuation completed.' });
  if (action === 'RESEARCH') return outputs.length ? sourced('.') : tool('research_notes', { question: `PI_FOLLOWONS:WORKER:${run}:${ids.join(',')}`, note_ids: ids, timeout_ms: 120000 });
  if (action === 'WORKER') {
    if ((body.tools ?? []).some(tool => ['web_search', 'web_search_preview'].includes(tool.type))) throw new Error('Research worker inherited hosted web');
    const names = (body.tools ?? []).map(tool => tool.function?.name ?? tool.name).filter(Boolean);
    if (names.some(name => !['find_notes', 'read_notes', 'list_note_activity'].includes(name))) throw new Error('Research worker inherited parent tools');
    const remembered = progress(history);
    const next = ids.find(id => !remembered.completed.includes(id));
    if (next) return tool('read_notes', { note_id: next });
    if (!remembered.evidence.length) throw new Error('Research selected no actually read evidence');
    return reply({ text: JSON.stringify({ evidence_ids: remembered.evidence.slice(-3), gaps: [] }) });
  }
  if (action === 'FRESH') return outputs.length ? sourced('.') : tool('read_note', { noteId: ids[0] });
  if (action === 'WEB') {
    if (compatible) throw new Error('Hosted web dispatched to compatible route');
    if (!(body.tools ?? []).some(tool => tool.type === 'web_search')) throw new Error('Hosted web tool absent');
    if (!outputs.length) {
      if (body.tool_choice?.type !== 'web_search') throw new Error('Initial hosted search was not forced');
      return tool('read_note', { noteId: ids[0] });
    }
    if (body.tool_choice?.type === 'web_search') throw new Error('Forced hosted search was retained on continuation');
    return sourced('. [Synthetic web source](https://example.com/pi-followons)');
  }
  if (action === 'ATTACH_RETRY' && attempt === 1) return reply({ text: '' });
  if (action === 'ATTACH' || action.startsWith('ATTACH_')) return reply({ text: 'Synthetic attachment delivery completed.' });
  throw new Error(`Unsupported follow-on action ${action}`);
}

/** Driver-side evidence. UI success alone cannot prove worker/summary routing. */
export function verifyFollowonsReceipts(requests, report) {
  if (report?.status !== 'passed' || report?.gate !== 'expanded-native-followons-fixture') throw new Error('Follow-on UI report did not pass');
  const verified = [];
  for (const protocol of ['local', 'openai']) {
    const path = protocol === 'local' ? '/local/v1/chat/completions' : '/openai/v1/responses';
    const records = requests.filter(record => record.path === path && record.journey?.startsWith('FOLLOWONS_') && (!report.run || JSON.stringify(record.body).includes(report.run)));
    for (const journey of ['RESEARCH', 'WORKER', 'SUMMARY_PARENT', 'SUMMARY_WORKER', 'FRESH', 'ATTACH', 'ATTACH_RETRY']) {
      if (!records.some(record => record.journey === `FOLLOWONS_${journey}` && record.completed)) throw new Error(`Missing ${protocol} ${journey} native provider receipt`);
    }
    const retry = records.filter(record => record.journey === 'FOLLOWONS_ATTACH_RETRY');
    if (retry.length !== 2 || JSON.stringify(historyOf(retry[0].body, protocol === 'local').at(-1)) !== JSON.stringify(historyOf(retry[1].body, protocol === 'local').at(-1))) throw new Error(`Attachment Retry wire bytes changed for ${protocol}`);
    const attach = records.find(record => record.journey === 'FOLLOWONS_ATTACH');
    const history = historyOf(attach.body, protocol === 'local');
    const user = history.findLast(item => item.role === 'user');
    if (!JSON.stringify(user).includes('pi-followons-attachment') || !JSON.stringify(user).includes('synthetic-attachment-bytes')) throw new Error(`Missing ${protocol} native attachment payload`);
    const modalities = protocol === 'local' ? [['IMAGE', 'image_url'], ['AUDIO', 'input_audio'], ['VIDEO', 'video_url']] : [['IMAGE', 'input_image'], ['PDF', 'input_file']];
    for (const [modality, type] of modalities) {
      const record = records.find(record => record.journey === `FOLLOWONS_ATTACH_${modality}` && record.completed);
      const currentUser = record && historyOf(record.body, protocol === 'local').findLast(item => item.role === 'user');
      const part = currentUser?.content?.find?.(part => part.type === type);
      if (!part) throw new Error(`Missing ${protocol} native ${type} payload`);
      const data = type === 'input_audio' ? part.input_audio?.data : type === 'input_file' ? part.file_data : typeof part.image_url === 'string' ? part.image_url : part.image_url?.url ?? part.video_url?.url;
      if (typeof data !== 'string' || !data.length || (type !== 'input_audio' && !data.includes(';base64,'))) throw new Error(`Malformed ${protocol} native ${type} bytes`);
      const expected = modality === 'IMAGE' ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1lEAAAAASUVORK5CYII='
        : Buffer.from(modality === 'AUDIO' ? 'RIFFsynthetic-audio-bytes' : modality === 'VIDEO' ? 'synthetic-video-bytes' : '%PDF-1.4 synthetic-pdf-bytes').toString('base64');
      if ((type === 'input_audio' ? data : data.split(',')[1]) !== expected) throw new Error(`Changed ${protocol} native ${type} bytes`);
    }
    verified.push(`${protocol}: parent/worker compaction, research, fresh read, attachment bytes and exact Retry`);
  }
  const web = requests.filter(record => record.journey === 'FOLLOWONS_WEB' && (!report.run || JSON.stringify(record.body).includes(report.run)));
  if (web.length !== 2 || web[0].body.tool_choice?.type !== 'web_search' || web[1].body.tool_choice?.type === 'web_search') throw new Error('Hosted forced-search release receipts missing');
  verified.push('hosted web forced on initial request and released on tool continuation');
  return verified;
}

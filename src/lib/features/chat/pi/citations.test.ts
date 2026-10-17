import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { admittedSourceIds, admitProviderMessage, openPiSource, parseCitationSegments, sourceIdFromHref, type AnswerSegments } from './citations';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const id = 'a'.repeat(48);
const other = 'b'.repeat(48);
const binding = { authorityId: 'authority', conversationId: 17, providerSessionId: 'provider-session' };
const message = (content: AssistantMessage['content']): AssistantMessage => ({ role: 'assistant', api: 'openai-responses', provider: 'openai', model: 'model', timestamp: 1,
  usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', content });
beforeEach(() => native.invoke.mockReset());
const refs = (answer: AnswerSegments) => answer.segments.flatMap(segment => segment.sources);
const literal = (answer: AnswerSegments) => answer.segments.map(segment => segment.text).join('');

describe('reserved citation selection', () => {
  it('preserves ordinary/source-free Markdown exactly', () => {
    const text = '## Summary\nOrdinary **Markdown** with [web](https://example.com) and `code`.';
    expect(parseCitationSegments(text)).toEqual({ segments: [{ text, sources: [] }] });
    expect(parseCitationSegments('')).toEqual({ segments: [{ text: '', sources: [] }] });
  });
  it('keeps adjacent/repeated exact tokens distinct and validates copied native links', () => {
    const parsed = parseCitationSegments(`One [[cite:${id}]][[cite:${other}]] then [Historical note source](gneauxghts-source:${id}).`);
    expect(refs(parsed)).toEqual([id, other, id]);
    expect(literal(parsed)).toBe('One  then .');
  });
  it('round-trips native note and quoted-passage labels with escaped Markdown punctuation', () => {
    const markdown = String.raw`[Note: Lantern \[draft\] · “The lantern is \*\*turquoise\*\*\.”](gneauxghts-source:${id})`;
    expect([...admittedSourceIds(markdown)]).toEqual([id]);
    expect(refs(parseCitationSegments(markdown))).toEqual([id]);
    expect(literal(parseCitationSegments(markdown))).toBe('');
  });
  it.each(['[[cite:]]', '[[cite:invented]]', `[[cite: ${id}]]`, `[[cite:${id}\n]]`, '[[cite missing colon]]', '[[cite:unterminated', `[[cite:${id.toUpperCase()}]]`, '[spoof](gneauxghts-source:foreign)', 'gneauxghts-source:%61', `[[cite:${'a'.repeat(5000)}]]`])('leaves malformed reserved selection inert: %s', text => {
    expect(refs(parseCitationSegments(text))).toEqual([]);
    expect(literal(parseCitationSegments(text))).toContain('[citation unavailable]');
    expect(literal(parseCitationSegments(text))).not.toContain('gneauxghts-source:');
    expect(literal(parseCitationSegments(text))).not.toContain('[[cite');
  });
  it('conservatively validates even a source token inside a code block', () => {
    expect(refs(parseCitationSegments(`\`[[cite:${id}]]\``))).toEqual([id]);
  });
  it('recognizes only exact canonical source navigation targets', () => {
    expect(sourceIdFromHref(`gneauxghts-source:${id}`)).toBe(id);
    for (const value of [`https://example.com/${id}`, `gneauxghts-source:${id}#fragment`, `gneauxghts-source:%61`, `GNEAUXGHTS-SOURCE:${id}`]) expect(sourceIdFromHref(value)).toBeUndefined();
  });
  it('does not let Markdown entity, percent, escaped or case-variant app links acquire an admitted renderer identity', () => {
    const forged = [
      `[x](gneauxghts-source&#58;${other})`, `[x](gneauxghts-source%3A${other})`,
      `[x](GNEAUXGHTS-SOURCE:${other})`, `[x](gneauxghts-source\\:${other})`,
      `[x](gneauxghts-source:${other})`
    ];
    const markdown = `[Revision source](gneauxghts-source:${id}) ${forged.join(' ')}`;
    expect([...admittedSourceIds(markdown)]).toEqual([id]);
    expect(sourceIdFromHref(`gneauxghts-source:${other}`)).toBe(other);
    expect(admittedSourceIds(markdown).has(other)).toBe(false);
  });
});

describe('mandatory terminal provider adapter', () => {
  it('atomically admits interleaved text while preserving signatures, reasoning, usage and tool calls', async () => {
    native.invoke.mockResolvedValue([{ markdown: 'Admitted one', sources: [] }, { markdown: 'Admitted two', sources: [] }]);
    const original = message([{ type: 'text', text: `One [[cite:${id}]]`, textSignature: 'provider-signature' },
      { type: 'thinking', thinking: 'Reasoning', thinkingSignature: 'opaque-thinking' },
      { type: 'toolCall', id: 'call', name: 'read_note', arguments: { noteId: 'note' } }, { type: 'text', text: 'Two' }]);
    const admitted = await admitProviderMessage(binding, original);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith('pi_chat_admit_answer', { ...binding, answers: [parseCitationSegments(`One [[cite:${id}]]`), parseCitationSegments('Two')] });
    expect(admitted).toMatchObject({ ...original, content: [{ ...original.content[0], text: 'Admitted one' }, original.content[1], original.content[2], { ...original.content[3], text: 'Admitted two' }] });
    expect(original.content[0]).toMatchObject({ text: `One [[cite:${id}]]` });
  });
  it('validates empty/tool-only responses and source-free summaries natively', async () => {
    native.invoke.mockResolvedValueOnce([]).mockResolvedValueOnce([{ markdown: '## Goal\nSummary', sources: [] }]);
    await admitProviderMessage(binding, message([{ type: 'toolCall', id: 'call', name: 'search_notes', arguments: { query: 'words' } }]));
    expect(native.invoke).toHaveBeenLastCalledWith('pi_chat_admit_answer', { ...binding, answers: [] });
    expect((await admitProviderMessage(binding, message([{ type: 'text', text: '## Goal\nSummary' }]))).content[0]).toMatchObject({ text: '## Goal\nSummary' });
  });
  it('does not turn native rejection or malformed block response into terminal success', async () => {
    native.invoke.mockRejectedValueOnce({ code: 'retired_authority', message: 'Retired' });
    await expect(admitProviderMessage(binding, message([{ type: 'text', text: 'Provisional' }]))).rejects.toMatchObject({ code: 'retired_authority' });
    native.invoke.mockResolvedValueOnce([]);
    await expect(admitProviderMessage(binding, message([{ type: 'text', text: 'Provisional' }]))).rejects.toThrow('invalid response');
  });
  it('opens only through native current source admission', async () => {
    native.invoke.mockResolvedValue({ kind: 'unavailable', code: 'revision_unavailable', message: 'Revision unavailable' });
    expect(await openPiSource('authority', id)).toMatchObject({ kind: 'unavailable' });
    expect(native.invoke).toHaveBeenCalledWith('pi_chat_open_source', { authorityId: 'authority', sourceId: id });
  });
});

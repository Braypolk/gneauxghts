import { invoke } from './nativeInvoke';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ReadSource, SourceLocation } from './notes';
import type { NativeBinding } from './nativeProvider';

export type AnswerSegments = { segments: Array<{ text: string; sources: string[] }> };
export type AdmittedAnswer = { markdown: string; sources: ReadSource[] };
export type SourceDestination =
  | { kind: 'note'; noteId: string; path: string; title: string; limitation?: string; location?: SourceLocation }
  | { kind: 'unavailable'; code: string; message: string };
export const SOURCE_SCHEME = 'gneauxghts-source:';
const sourceId = /^[a-f0-9]{48}$/;
const unavailable = '[citation unavailable]';

/** Reserved citation syntax only; ordinary Markdown and provider protocols remain Pi-owned. */
export function parseCitationSegments(markdown: string): AnswerSegments {
  const segments: AnswerSegments['segments'] = [];
  // The whole simple inline link is consumed, so a copied admitted link never nests.
  // Bare/reserved malformed targets are consumed conservatively and remain inert.
  const reserved = /\[(?:\\[^\r\n]|[^\]\\\r\n])*\]\(gneauxghts-source:[^)\r\n]*(?:\)|$)|\[\[cite(?:(?!\]\])[\s\S])*(?:\]\]|$)|gneauxghts-source:[^\s)\]<>]*/g;
  let start = 0;
  for (const match of markdown.matchAll(reserved)) {
    const at = match.index!;
    if (at > start) segments.push({ text: markdown.slice(start, at), sources: [] });
    const value = match[0];
    let id: string | undefined;
    if (value.startsWith('[[cite:') && value.endsWith(']]')) id = value.slice(7, -2);
    else if (value.startsWith('[') && value.endsWith(')')) {
      const marker = value.indexOf(`](${SOURCE_SCHEME}`);
      if (marker >= 0) id = value.slice(marker + 2 + SOURCE_SCHEME.length, -1);
    } else if (value.startsWith(SOURCE_SCHEME)) id = value.slice(SOURCE_SCHEME.length);
    segments.push(id && sourceId.test(id) ? { text: '', sources: [id] } : { text: unavailable, sources: [] });
    start = at + value.length;
  }
  if (start < markdown.length || !segments.length) segments.push({ text: markdown.slice(start), sources: [] });
  return { segments };
}

/** Only terminal admitted assistant Markdown may call this renderer helper. */
export function sourceIdFromHref(href: string): string | undefined {
  if (!href.startsWith(SOURCE_SCHEME)) return;
  const id = href.slice(SOURCE_SCHEME.length);
  return sourceId.test(id) ? id : undefined;
}
/** Call only for successful terminal assistant text; Markdown decoding is not admission. */
export function admittedSourceIds(markdown: string): ReadonlySet<string> {
  // Native admission replaces every reserved target, including copied links,
  // with an escaped note-title label. Labels never grant source authority.
  return new Set([...markdown.matchAll(/\[(?:Note: (?:\\[^\r\n]|[^\]\\\r\n])*|Revision source|Historical note source|Historical read \(opens current note; content may differ\))\]\(gneauxghts-source:([a-f0-9]{48})\)/g)]
    .map(match => match[1]));
}
export const openPiSource = (authorityId: string, sourceId: string) =>
  invoke<SourceDestination>('pi_chat_open_source', { authorityId, sourceId });

/** Mandatory provider callback, shared by generation, tool rounds and standard compaction. */
export async function admitProviderMessage(binding: NativeBinding, message: AssistantMessage): Promise<AssistantMessage> {
  const text = message.content.filter(block => block.type === 'text');
  const admitted = await invoke<AdmittedAnswer[]>('pi_chat_admit_answer', {
    ...binding, answers: text.map(block => parseCitationSegments(block.text))
  });
  if (admitted.length !== text.length) throw new Error('Citation admission returned an invalid response');
  let index = 0;
  return { ...message, content: message.content.map(block => block.type === 'text'
    ? { ...block, text: admitted[index++].markdown } : block) };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ChainOfThought from '$lib/components/ai-elements/chain-of-thought/chain-of-thought.svelte';
import type { ChatMessage, ChatCitation, ChatPart } from '$lib/features/chat/types';
import { admittedProbeRead, revealProbeReadActivity } from './probeReadActivity';

const source = { kind: 'note', id: 'source-1', noteId: 'actual-note', notePath: '/vault/Orchard.md', label: 'Orchard', excerpt: 'Seven pear trees.' } as Extract<ChatCitation, { kind: 'note' }>;
const step: Extract<ChatPart, { type: 'tool' }> = { id: 'tool:read', type: 'tool', callId: 'read', name: 'read_note', title: 'Read note evidence', status: 'success', readSources: [source] };
const message = { id: 'allowed-answer', citations: [source], parts: [step] } as ChatMessage;
afterEach(() => vi.unstubAllGlobals());

describe('normal allowed-answer read Activity', () => {
  it('requires successful read delivery and admitted citation for the same Note Identity', () => {
    expect(admittedProbeRead(message, 'actual-note')).toBe(source);
    expect(() => admittedProbeRead(message, 'other-note')).toThrow('admitted Note Identity');
    expect(() => admittedProbeRead({ ...message, parts: [{ ...step, status: 'denied' }] }, 'actual-note')).toThrow('successful actual read');
    expect(() => admittedProbeRead({ ...message, parts: [{ ...step, readSources: [{ ...source, noteId: 'other-note' }] }] }, 'actual-note')).toThrow('successful actual read');
  });
  it('clicks only the exact allowed message Activity toggle before checking its normal source button', async () => {
    let expanded = false;
    const toggle = { disabled: false, getAttribute: (name: string) => name === 'aria-expanded' ? String(expanded) : 'Activity, 1 of 1 actions complete. Toggle details', click: vi.fn(() => { expanded = true; }) };
    const read = { disabled: false, textContent: source.label, getAttribute: () => 'Open Orchard' };
    const root = { get textContent() { return expanded ? 'Read note evidence' : 'Activity'; }, querySelectorAll: (selector: string) => selector.startsWith('button') ? [toggle] : expanded ? [read] : [] };
    const querySelector = vi.fn(() => root); vi.stubGlobal('document', { querySelector });
    const until = async <T>(read: () => T | Promise<T>): Promise<NonNullable<T>> => { const value = await read(); if (!value) throw new Error('Missing activity control'); return value as NonNullable<T>; };
    expect(await revealProbeReadActivity({ message, noteId: 'actual-note', until })).toMatchObject({ messageId: 'allowed-answer', noteId: 'actual-note', readButtonLabel: 'Open Orchard' });
    expect(querySelector).toHaveBeenCalledExactlyOnceWith('[data-chat-message-id="allowed-answer"]');
    expect(toggle.click).toHaveBeenCalledOnce();
  });
  it('matches the real rendered expanded Activity and read-source control contract', () => {
    const body = render(ChainOfThought, { props: { steps: [step], open: true, onOpenCitation: vi.fn() } }).body;
    expect(body).toContain('Activity, 1 of 1 actions complete. Toggle details');
    expect(body).toContain('aria-expanded="true"');
    expect(body).toContain('aria-label="Notes and passages read"');
    expect(body).toContain('aria-label="Open Orchard"');
    expect(body).toContain('Read note evidence');
  });
});

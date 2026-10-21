import { afterEach, describe, expect, it } from 'vitest';
import { PI_CONTEXT } from '#lib/features/chat/pi/runtime.js';
import { openBrowserPiChat, seedBrowserPiChat, readBrowserPiChat, changeBrowserPiRead } from './piBrowserFixture';

afterEach(async () => { await (await openBrowserPiChat()).close(); });

describe('browser Pi presentation fixture', () => {
  it('uses actual Pi writes and submissions without native chat command emulation', async () => {
    const id = await seedBrowserPiChat({ title: 'Retained Pi history', count: 4 });
    const runtime = await openBrowserPiChat();
    const conversation = (await runtime.harness.conversation(Number(id) as Parameters<typeof runtime.harness.conversation>[0], PI_CONTEXT))!;
    expect((await readBrowserPiChat())[0].messages).toHaveLength(4);
    await (await conversation.submit({ type: 'input', content: 'A new question' }, PI_CONTEXT)).wait(PI_CONTEXT);
    const result = (await readBrowserPiChat())[0];
    expect(result.messages.filter(message => message.role === 'user').at(-1)?.content).toBe('A new question');
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'Fixture ordinary answer.' });
  });

  it('retires restricted browser authority and preserves existing Pi history', async () => {
    const runtime = await openBrowserPiChat(), conversation = await runtime.createConversation();
    const authority = (await runtime.authorityForConversation(conversation.id))!;
    expect(changeBrowserPiRead(authority.authorityId, authority.revision, { mode: 'attachedNotesOnly', attachedNoteIds: [] }).retired).toBe(true);
    expect(await runtime.harness.conversation(conversation.id, PI_CONTEXT)).toBeDefined();
    expect(() => changeBrowserPiRead(authority.authorityId, 1, { mode: 'fullVault', attachedNoteIds: [] })).toThrow('Stale');
  });
});

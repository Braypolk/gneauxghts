import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ChatPanel from './ChatPanel.svelte';
import { createChatController } from './controller.svelte';
import { fakeApi, settings } from './chatTestSupport';

const contextNote = { noteId: 'note-1', notePath: '/vault/Note.md', noteTitle: 'Note' };

describe('ChatPanel initial render', () => {
  it('renders the configured vault access from the real controller', async () => {
    const fake = fakeApi();
    fake.api.listConversations.mockResolvedValue([]);
    fake.api.getSettings.mockResolvedValue({ ...settings, defaultVaultAccess: 'full' });
    const controller = createChatController(fake.api);
    await controller.initialize();
    const body = render(ChatPanel, { props: { controller, autoInitialize: false, contextNote } }).body;
    expect(body).toContain('Full vault');
    expect(body).toContain('aria-label="Vault access"');
    controller.dispose();
  });

  it('withholds configuration controls before initialization completes', () => {
    const controller = createChatController(fakeApi().api);
    const body = render(ChatPanel, { props: { controller, autoInitialize: false, contextNote } }).body;
    expect(body).not.toContain('aria-label="Vault access"');
    expect(body).not.toContain('Allow note');
    controller.dispose();
  });
});

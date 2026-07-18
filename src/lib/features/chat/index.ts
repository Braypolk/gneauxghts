export { chatApi, CHAT_COMMANDS, TauriChatApi, type ChatApi } from './api';
export { createChatController, type ChatController, type ChatControllerState } from './controller';
export { formatDiscussionDraft, mergeDiscussionDraft, type ChatDraftSeed } from './discussionContext';
export * from './types';
// Import ChatPanel from './ChatPanel.svelte' directly — barrel re-export caused TDZ with Notepad.

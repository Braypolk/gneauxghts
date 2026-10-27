import { defineDoc } from '@earendil-works/pi-durable';

// Internal title scopes never appear as human chats.
export const ChatDoc = defineDoc({ kind: 'gneauxghts.chat', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ title: '', authorityId: '', createdAtMillis: Date.now(), retired: false as boolean, forgotten: false as boolean, purpose: 'chat' as 'chat' | 'noteTitles' }) });

/** Presentation cursor only; Pi submissions remain the completion authority. */
export const ChatReadDoc = defineDoc({ kind: 'gneauxghts.chatRead', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ initialized: false as boolean, throughSubmissionId: 0 }) });

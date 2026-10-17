import { invoke } from './nativeInvoke';

export type ReadMode = 'fullVault' | 'attachedNotesOnly';
export type AuthorityRef = { authorityId: string };
export type ConversationBinding = { conversationId: number; providerSessionId: string };
export type ReadPolicy = { mode: ReadMode; attachedNoteIds: string[] };
export type NoteScope = { noteIds: string[]; folders: string[] };
export type WriteOperation = 'create' | 'update';
export type WriteGrant = { duration: 'off' }
  | { duration: 'temporary'; conversationId: number; operations: WriteOperation[]; scope: NoteScope }
  | { duration: 'always'; operations: WriteOperation[]; scope: NoteScope };
export type WritePolicy = { grant: WriteGrant; reviewBeforeApplying: boolean };
export type AuthoritySnapshot = AuthorityRef & { revision: number; read: ReadPolicy; write: WritePolicy; retired: boolean };
export type DomainError = { code: string; message: string };

export const bindAuthority = (binding: ConversationBinding, read: ReadPolicy) =>
  invoke<AuthoritySnapshot>('pi_chat_bind_authority', { binding, read });
export const readAuthority = (authorityId: string) =>
  invoke<AuthoritySnapshot>('pi_chat_authority', { authorityId });
export const setReadPolicy = (authorityId: string, expectedRevision: number, read: ReadPolicy) =>
  invoke<AuthoritySnapshot>('pi_chat_set_read_policy', { authorityId, expectedRevision, read });
export const retireAuthority = (authorityId: string, expectedRevision: number) =>
  invoke<void>('pi_chat_retire_authority', { authorityId, expectedRevision });
export const setNoteExclusion = (noteId: string, excluded: boolean) =>
  invoke<{ retiredAuthorityIds: string[] }>('pi_chat_set_exclusion', { noteId, excluded });

import { invoke } from './nativeInvoke';

export type ReadMode = 'fullVault' | 'attachedNotesOnly';
export type AuthorityRef = { authorityId: string };
export type ConversationBinding = { conversationId: number; providerSessionId: string };
export type ReadPolicy = { mode: ReadMode; attachedNoteIds: string[] };
export type NoteScope = { noteIds: string[]; folders: string[] };
export type WriteOperation = 'update' | 'create';
export type WriteGrant = { duration: 'off' }
  | { duration: 'temporary'; conversationId: number; operations: WriteOperation[]; scope: NoteScope }
  | { duration: 'always'; operations: WriteOperation[]; scope: NoteScope };
export type WritePolicy = { grant: WriteGrant; reviewBeforeApplying: boolean };
export type VaultWritePolicy = WritePolicy & { grant: Exclude<WriteGrant, { duration: 'temporary' }> };
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


/** Duration changes preserve explicit operations and scope; first use grants edits only. */
export function writeGrantForDuration(write: WritePolicy | undefined, duration: WriteGrant['duration'], conversationId: number): WriteGrant {
  if (duration === 'off') return { duration };
  const current = write?.grant;
  const permissions = current && current.duration !== 'off'
    ? { operations: current.operations, scope: current.scope }
    : { operations: ['update'] as WriteOperation[], scope: { noteIds: [], folders: ['.'] } };
  return duration === 'temporary' ? { duration, conversationId, ...permissions } : { duration, ...permissions };
}
export function withCreationPermission(write: WritePolicy, allow: boolean): WritePolicy {
  if (write.grant.duration === 'off') return write;
  const operations: WriteOperation[] = write.grant.operations.filter(operation => operation !== 'create');
  if (allow) operations.push('create');
  // The normal UI grants edits first; preserve valid create-only native grants when disabling.
  if (!operations.length) return { ...write, grant: { duration: 'off' } };
  return { ...write, grant: { ...write.grant, operations } };
}

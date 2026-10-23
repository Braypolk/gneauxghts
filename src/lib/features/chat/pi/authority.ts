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


/** Duration changes preserve explicit operations and scope; first use grants content and filename changes. */
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
  // The UI starts with edits; preserve independently granted native operations.
  if (!operations.length) return { ...write, grant: { duration: 'off' } };
  return { ...write, grant: { ...write.grant, operations } };
}

/** Explicit folder edits preserve independently scoped notes and granted operations. */
export function withWriteFolders(write: WritePolicy, value: string): WritePolicy {
  if (write.grant.duration === 'off') return write;
  if (value === write.grant.scope.folders.join('\n')) return write;
  const folders = [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
  if (folders.some(folder => folder !== '.' && (folder.startsWith('/') || folder.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(folder) || folder.split('/').some(part => !part || part.startsWith('.'))))) {
    throw new Error('Use . for the vault root or visible relative folders such as Projects, one per line.');
  }
  if (!folders.length && !write.grant.scope.noteIds.length) throw new Error('Choose at least one allowed write folder.');
  return { ...write, grant: { ...write.grant, scope: { ...write.grant.scope, folders } } };
}

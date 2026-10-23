import { expect, it } from 'vitest';
import { withCreationPermission, withWriteFolders, writeGrantForDuration, type WritePolicy } from './authority';

it('grants content and filename changes on first use and preserves explicit operations on duration changes', () => {
  expect(writeGrantForDuration(undefined, 'temporary', 7)).toEqual({ duration: 'temporary', conversationId: 7, operations: ['update'], scope: { noteIds: [], folders: ['.'] } });
  const write: WritePolicy = { grant: { duration: 'temporary', conversationId: 7, operations: ['update'], scope: { noteIds: ['note'], folders: ['Projects'] } }, reviewBeforeApplying: true };
  expect(writeGrantForDuration(write, 'always', 7)).toEqual({ duration: 'always', operations: ['update'], scope: { noteIds: ['note'], folders: ['Projects'] } });
});

it('keeps creation separate from content and filename changes', () => {
  const write: WritePolicy = { grant: { duration: 'always', operations: ['update'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying: true };
  const creation = withCreationPermission(write, true);
  expect(creation.grant).toMatchObject({ operations: ['update', 'create'] });
  expect(withCreationPermission(creation, false)).toEqual(write);
  const off: WritePolicy = { grant: { duration: 'off' }, reviewBeforeApplying: false };
  expect(withCreationPermission(off, true)).toBe(off);
});

it('changes explicit folders without widening operations or losing existing note scope', () => {
  const write: WritePolicy = { grant: { duration: 'temporary', conversationId: 9, operations: ['update'], scope: { noteIds: ['note-1'], folders: ['Projects'] } }, reviewBeforeApplying: true };
  expect(withWriteFolders(write, '.\nProjects\nProjects\nResearch/Ideas').grant).toEqual({ duration: 'temporary', conversationId: 9, operations: ['update'], scope: { noteIds: ['note-1'], folders: ['.', 'Projects', 'Research/Ideas'] } });
  expect(write.grant).toMatchObject({ scope: { folders: ['Projects'] } });
  expect(withWriteFolders(write, '').grant).toMatchObject({ scope: { noteIds: ['note-1'], folders: [] } });
});

it('retains an untouched native folder representation when another setting changes', () => {
  const write: WritePolicy = { grant: { duration: 'always', operations: ['update'], scope: { noteIds: ['note-1'], folders: ['Projects/'] } }, reviewBeforeApplying: false };
  expect(withWriteFolders(write, 'Projects/')).toBe(write);
});

it.each(['/absolute', '../outside', 'Projects/../outside', '.hidden', 'Projects/.hidden', 'Projects\\Elsewhere', 'Projects//Ideas', 'Projects/./Ideas', 'Projects\u0000'])('rejects unsupported folder scope %j before sending policy', folder => {
  const write: WritePolicy = { grant: { duration: 'always', operations: ['update'], scope: { noteIds: [], folders: ['.'] } }, reviewBeforeApplying: true };
  expect(() => withWriteFolders(write, folder)).toThrow('visible relative folders');
  expect(() => withWriteFolders(write, '\n')).toThrow('at least one');
});

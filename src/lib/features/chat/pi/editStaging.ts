import { createEditTool } from '@earendil-works/pi-durable/tools';
import { err, ok, FileError, ExecutionError, type ExecutionEnv, type Result } from '@earendil-works/pi-durable/env';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord/context';

export const piEdit = createEditTool();

/** One immutable note, with writes captured in memory. No vault filesystem capability. */
export async function stageNoteEdit(markdown: string, edits: Array<{ oldText: string; newText: string }>, api: ToolExecutionApi, context: Context) {
  const path = '/note.md';
  let candidate: string | undefined;
  const unsupported = async () => err<never, FileError>(new FileError('not_supported', 'Only staging this note is supported.'));
  const samePath = async (value: string): Promise<Result<string, FileError>> => value === path ? ok(path) : err(new FileError('permission_denied', 'Unknown staging path.'));
  const env: ExecutionEnv = {
    id: `note-edit-${api.taskId}`, cwd: '/', absolutePath: samePath, canonicalPath: samePath,
    joinPath: unsupported,
    async fileInfo(value) { return value === path ? ok({ name: 'note.md', path, kind: 'file', size: new TextEncoder().encode(markdown).length, mtimeMs: 0 }) : unsupported(); },
    async readTextFile(value) { return value === path ? ok(markdown) : unsupported(); },
    async writeFile(value, content) {
      if (value !== path || typeof content !== 'string') return unsupported();
      candidate = content;
      return ok(undefined);
    },
    openTextLineReader: unsupported, readTextLines: unsupported, readBinaryFile: unsupported,
    openBinaryReader: unsupported, appendFile: unsupported, truncateFile: unsupported, flushFile: unsupported,
    renameFile: unsupported, listDir: unsupported, openDirReader: unsupported, watch: unsupported,
    exists: unsupported, createDir: unsupported, remove: unsupported, createTempDir: unsupported,
    createTempFile: unsupported, async cleanup() {},
    async exec() { return err(new ExecutionError('shell_unavailable', 'Note edits have no shell.')); }
  };
  const result = await piEdit.execute({ path, edits }, { ...api, env }, context);
  if (candidate === undefined || !result.details) throw new Error('Pi did not produce a note edit.');
  return { markdown: candidate, patch: result.details.patch };
}

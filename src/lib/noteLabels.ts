/** Keep identity-bound capture filenames out of visible note labels. */
export function noteFileLabel(fileName: string, noteId: string | null) {
  return noteId && fileName.replace(/\.md$/i, '') === `Untitled Note ${noteId}`
    ? 'Untitled note' : fileName;
}

export interface DraftContent {
  title: string;
  markdown: string;
  tags: string[];
  tagsError: string | null;
}

/** Private unfinished editor work and its last saved base; never a note revision. */
export interface DraftBackup extends DraftContent {
  id: string;
  version: number;
  sourceNoteId: string | null;
  sourcePath: string | null;
  baseline?: DraftContent | null;
  updatedAtMillis: number;
}

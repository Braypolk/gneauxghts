import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { ResolveNoteAuthority } from './notes';
import { publishCandidate } from './mutationTool';

/** A narrow filename operation; preparation, review, effects and replay stay shared. */
export function renameExtension(resolveAuthority: ResolveNoteAuthority) {
  return defineExtension({ name: 'gneauxghts.rename', tools: [defineTool({
    name: 'rename_note',
    description: 'Rename a saved Markdown note in its current folder. Native code validates the exact requested title and fixes both filenames for review. Preserves Note Identity, body and authored properties; never overwrites a destination or rewrites backlinks.',
    parameters: Type.Object({
      noteId: Type.String({ minLength: 1, maxLength: 512, description: 'Exact Note Identity from a note read, never a file path.' }),
      expectedReadSourceId: Type.String({ minLength: 1, maxLength: 512, description: 'source.sourceId from read_note or a committed publication read for this exact current note. A changed note requires a new read.' }),
      title: Type.String({ minLength: 1, maxLength: 512, description: 'Exact new title without a .md extension, path or folder. Native code derives the filename in the current folder and rejects unsupported names instead of silently changing them.' })
    }, { additionalProperties: false }),
    constrainedSampling: { type: 'json_schema', strict: 'prefer' }, replay: 'safe', executionMode: 'sequential',
    async execute({ noteId, expectedReadSourceId, title }, api, context) {
      return publishCandidate(api, context, resolveAuthority, 'rename', async () => ({
        // Validated tool arguments already belong to Pi's durable checkpoint.
        title, mutation: { operation: 'rename', noteId, expectedReadSourceId, title }
      }));
    }
  })], sections: [{ key: 'gneauxghts-rename', render: () =>
    'Use rename_note for a saved note’s filename/title change, keeping its current folder. Supply only the requested title without a .md extension or path. ID-based references keep working; ordinary filename/path links may stop resolving and backlinks are not rewritten.'
  }] });
}

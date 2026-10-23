import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { invoke } from './nativeInvoke';
import type { NoteRead, ResolveNoteAuthority } from './notes';
import { piEdit, stageNoteEdit } from './editStaging';
import { publishCandidate, type EditCandidate } from './mutationTool';

const parameters = Type.Object({
  noteId: Type.String({ minLength: 1, maxLength: 512, description: 'Exact Note Identity from a note read, never a file path.' }),
  expectedReadSourceId: Type.String({ minLength: 1, maxLength: 512, description: 'source.sourceId from read_note or a committed publication read for this exact current note. A changed note requires a new read.' }),
  edits: piEdit.parameters.properties.edits
}, { additionalProperties: false });
/** Pi owns tool replay, staged content, review and task progression. Native owns effects. */
export function editExtension(resolveAuthority: ResolveNoteAuthority) {
  return defineExtension({ name: 'gneauxghts.edit', tools: [defineTool({
    name: 'edit_note', description: 'Apply targeted replacements to the body or user-authored frontmatter of a saved note. Properties can be added, changed or removed; native code preserves managed identity and lifecycle metadata. Changes content only; use rename_note for its filename.',
    parameters, constrainedSampling: { type: 'json_schema', strict: 'prefer' }, replay: 'safe', executionMode: 'sequential',
    prepareArguments(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Supply a note identity, read source and edits.');
      // Pi repairs edit shapes; its normal validation still checks the domain
      // identifiers and rejects additional fields, including arbitrary paths.
      const identifiers = input as Record<string, unknown>;
      if (typeof identifiers.noteId !== 'string' || typeof identifiers.expectedReadSourceId !== 'string') throw new Error('Supply the exact note identity and read source from read_note.');
      return { ...piEdit.prepareArguments!(input), noteId: identifiers.noteId, expectedReadSourceId: identifiers.expectedReadSourceId };
    },
    async execute({ noteId, expectedReadSourceId, edits }, api, context) {
      return publishCandidate(api, context, resolveAuthority, 'edit', async authorityId => {
        // Reuse the exact staged edit after restart, never rerun replacements
        // against canonical bytes that may already have changed.
        const previous = await api.memo<EditCandidate>('candidate', context);
        if (previous) return previous;
        const base = await invoke<NoteRead>('pi_chat_read_mutation_base', { authorityId, noteId, expectedReadSourceId });
        const staged = await stageNoteEdit(base.markdown, edits, api, context);
        return api.memo<EditCandidate>('candidate', { title: base.source.title, patch: staged.patch, mutation: { operation: 'update', noteId, expectedReadSourceId, markdown: staged.markdown } }, context);
      });
    }
  }), defineTool({
    name: 'create_note',
    description: 'Create one Markdown note in an existing visible vault folder. Native code chooses its identity and safe filename from the title, manages metadata and never overwrites an existing destination. Review shows the exact destination and authored content.',
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 512, description: 'Human-readable note title. Native code derives the filename.' }),
      markdown: Type.String({ maxLength: 8 * 1024 * 1024, description: 'Complete Markdown content. Native code owns managed metadata and identity.' }),
      folder: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, description: 'Existing visible folder relative to the vault, or "." for its root. Omit or use null for the vault root. Does not create folders.' }))
    }, { additionalProperties: false }),
    constrainedSampling: { type: 'json_schema', strict: 'prefer' }, replay: 'safe', executionMode: 'sequential',
    async execute({ title, markdown, folder = '.' }, api, context) {
      return publishCandidate(api, context, resolveAuthority, 'create', async () => ({
        // Pi checkpoints these validated arguments before executing the tool.
        title, mutation: { operation: 'create', title, markdown, folder }
      }));
    }
  })], sections: [{ key: 'gneauxghts-edit', render: () =>
    'For edit_note, copy unique oldText from the exact note read and provide its replacement as newText. For create_note, choose an existing visible folder or the vault root; this tool does not create folders.'
  }] });
}

import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import type { ProposalReviewSession } from '$lib/features/proposals/reviewSession.svelte';
import type { EditorCapabilityAdapter } from '../editor/editorCapabilities';
import type { DocumentEditingService } from '../document/documentEditingService';
import { getDocumentPath } from '../document/documentState';
import { getPaneNote, type NotepadState } from '../state/noteStore';
import type { WorkspaceStore, NotepadPaneId } from '../workspace/workspaceStore.svelte';
import { paneHasCapability } from '../workspace/paneCapabilities';
import type { NotepadWorkspaceSession } from './notepadWorkspaceSession';

export interface NotepadProposalAdapterDeps {
  workspace: WorkspaceStore;
  state: NotepadState<NotepadPaneId>;
  commands: NotepadWorkspaceSession;
  documentEditing: DocumentEditingService<NotepadPaneId>;
  getEditor: (paneId: NotepadPaneId) => EditorCapabilityAdapter | null;
  session?: ProposalReviewSession;
}

/** Read-only pane capability projection; complete presentation belongs to the workspace session. */
export function createNotepadProposalAdapter(deps: NotepadProposalAdapterDeps) {
  const { workspace, state, commands } = deps;
  const orchestration = createProposalOrchestration({
    session: deps.session,
    getEditorPaneDocument: path => {
      const ids = path ? workspace.paneOrder : workspace.getEditorPaneIds();
      const paneId = ids.find(id => {
        const document = getPaneNote(state, workspace, id);
        return path ? getDocumentPath(document) === path : Boolean(getDocumentPath(document));
      }) ?? (path ? null : ids[0]);
      return paneId ? getPaneNote(state, workspace, paneId) : null;
    },
    getEditorForDocument: document => {
      const paneId = workspace.getPaneIdsForDocument(document.handle).find(
        id => paneHasCapability(workspace.getPaneState(id).kind, 'edit-document')
      );
      const editor = paneId ? deps.getEditor(paneId) : null;
      return editor?.isReady() ? editor : null;
    },
    presentReviewDocument: commands.presentReviewDocument,
    reloadReviewDocument: commands.reloadReviewDocument,
    onReviewMarkdownChange: deps.documentEditing.recordReviewEdit,
    finishReviewDocument: commands.finishReviewDocument,
    acknowledgeDocumentCommit: commands.acknowledgeDocumentCommit
  });
  return { orchestration };
}

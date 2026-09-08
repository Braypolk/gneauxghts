import {
  createNoteDraftState,
  createNotepadState
} from './noteStore';

const initialNote = createNoteDraftState();

export const initialNotepadDocumentHandle = initialNote.handle;
export const notepadState = $state(
  createNotepadState(initialNote)
);

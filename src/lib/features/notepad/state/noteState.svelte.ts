import {
  createNoteDraftState,
  createNotepadState
} from './noteStore';

const initialNote = createNoteDraftState();

export const initialNotepadNoteKey = initialNote.key;
export const notepadState = $state(
  createNotepadState(initialNote)
);

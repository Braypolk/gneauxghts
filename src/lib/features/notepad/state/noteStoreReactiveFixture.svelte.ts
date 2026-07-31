import {
  createNotepadState,
  type NoteDraftState,
  type NotepadState
} from './noteStore';

class ReactiveNotepadStateFixture {
  state: NotepadState;

  constructor(initialNote: NoteDraftState) {
    this.state = $state(createNotepadState(initialNote));
  }
}

/** Test fixture that exercises note-store operations through Svelte deep state. */
export function createReactiveNotepadState(
  initialNote: NoteDraftState
) {
  return new ReactiveNotepadStateFixture(initialNote).state;
}

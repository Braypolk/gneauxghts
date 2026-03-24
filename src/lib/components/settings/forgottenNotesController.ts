import { invoke } from '@tauri-apps/api/core';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';

type ForgottenAction = 'restore_forgotten_notes' | 'delete_forgotten_notes';

interface ForgottenNotesControllerDeps {
  getSelectedForgottenPaths: () => string[];
  setSelectedForgottenPaths: (paths: string[]) => void;
  getForgottenNotes: () => ForgottenNoteSummary[];
  setForgottenNotes: (notes: ForgottenNoteSummary[]) => void;
  setIsLoadingForgottenNotes: (value: boolean) => void;
  setIsUpdatingForgottenNotes: (value: boolean) => void;
}

export function createForgottenNotesController({
  getSelectedForgottenPaths,
  setSelectedForgottenPaths,
  getForgottenNotes,
  setForgottenNotes,
  setIsLoadingForgottenNotes,
  setIsUpdatingForgottenNotes
}: ForgottenNotesControllerDeps) {
  async function loadForgottenNotes() {
    setIsLoadingForgottenNotes(true);

    try {
      const forgottenNotes = await invoke<ForgottenNoteSummary[]>('list_forgotten_notes');
      setForgottenNotes(forgottenNotes);
      setSelectedForgottenPaths(
        getSelectedForgottenPaths().filter((path) =>
          forgottenNotes.some((note) => note.forgottenPath === path)
        )
      );
    } catch (error) {
      console.error('Failed to load forgotten notes:', error);
    } finally {
      setIsLoadingForgottenNotes(false);
    }
  }

  async function runForgottenAction(command: ForgottenAction, forgottenPaths: string[]) {
    if (forgottenPaths.length === 0) return;

    setIsUpdatingForgottenNotes(true);
    try {
      await invoke(command, { forgottenPaths });
      setSelectedForgottenPaths(
        getSelectedForgottenPaths().filter((path) => !forgottenPaths.includes(path))
      );
      await loadForgottenNotes();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      setIsUpdatingForgottenNotes(false);
    }
  }

  function toggleForgottenSelection(forgottenPath: string, checked: boolean) {
    if (checked) {
      setSelectedForgottenPaths(Array.from(new Set([...getSelectedForgottenPaths(), forgottenPath])));
      return;
    }

    setSelectedForgottenPaths(getSelectedForgottenPaths().filter((path) => path !== forgottenPath));
  }

  function toggleAllForgottenSelections(checked: boolean) {
    setSelectedForgottenPaths(checked ? getForgottenNotes().map((note) => note.forgottenPath) : []);
  }

  return {
    loadForgottenNotes,
    runForgottenAction,
    toggleForgottenSelection,
    toggleAllForgottenSelections
  };
}

export function formatForgottenRetention(days: number) {
  return `${days} day${days === 1 ? '' : 's'}`;
}

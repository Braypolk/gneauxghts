export type EditDiffLayout = 'inline' | 'side-by-side';

const STORAGE_KEY = 'gneauxghts.edit-diff-layout';

function readPreference(): EditDiffLayout {
  if (typeof window === 'undefined') return 'inline';
  return window.localStorage.getItem(STORAGE_KEY) === 'side-by-side' ? 'side-by-side' : 'inline';
}

/** Device-local presentation preference, independent of edit permission and approval. */
class EditDiffLayoutStore {
  preference = $state<EditDiffLayout>(readPreference());

  setPreference = (value: EditDiffLayout): void => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, value);
    this.preference = value;
  };
}

export const editDiffLayout = new EditDiffLayoutStore();

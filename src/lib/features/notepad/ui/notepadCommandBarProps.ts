import type { LocationHistoryEntry } from '$lib/features/notepad/navigation/locationMru';
import type { SearchItem } from '$lib/types/semantic';
import type { SearchMode } from '$lib/features/notepad/search/search';

/**
 * Forget/unforget bundle: the chrome on the left of the command bar.
 */
export interface NotepadCommandBarForgetProps {
  canUnforget: boolean;
  canForget?: boolean;
  itemLabel?: 'note' | 'chat';
  onForget: () => void;
  onUnforget: () => void;
}

/**
 * Remember bundle: the action menu on the right of the command bar.
 */
export interface NotepadCommandBarRememberProps {
  label?: string;
  ariaLabel?: string;
  onRemember: () => void;
}

/**
 * Search/results bundle: the central search input and result list.
 */
export interface NotepadCommandBarSearchProps {
  searchMode: SearchMode;
  searchQuery: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  searchResults: SearchItem[];
  pinnedNotes: SearchItem[];
  recentLocations: LocationHistoryEntry[];
  isSearching: boolean;
  onSearchInput: (value: string) => void;
  onSearchModeChange: (mode: SearchMode) => void | Promise<void>;
  onMatchCaseChange: (enabled: boolean) => void | Promise<void>;
  onMatchWholeWordChange: (enabled: boolean) => void | Promise<void>;
  onSearchSelect: (result: SearchItem) => void;
  onSearchNavigate?: (result: SearchItem) => void | Promise<void>;
  onPinnedNoteSelect: (result: SearchItem) => void;
  onSetNotePinned: (noteId: string, pinned: boolean) => void | Promise<void>;
  onRecentLocationSelect: (entry: LocationHistoryEntry) => void;
  onRecentLocationShortcut: (index: number) => void | Promise<void>;
  onSearchOpen: () => void;
  /** Search closed without a destination; return the user to where they were. */
  onSearchDismiss?: () => void;
  /** A destination was chosen; it now owns focus. */
  onSearchCommit?: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
}

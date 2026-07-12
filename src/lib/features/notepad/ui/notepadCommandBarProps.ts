import type { RecentTaskItem } from '$lib/features/notepad/model/types';
import type { SearchItem } from '$lib/types/semantic';
import type { SearchMode } from '$lib/features/notepad/search/search';

/**
 * Forget/unforget bundle: the chrome on the left of the command bar.
 */
export interface NotepadCommandBarForgetProps {
  canUnforget: boolean;
  onForget: () => void;
  onUnforget: () => void;
}

/**
 * Remember bundle: the action menu on the right of the command bar.
 */
export interface NotepadCommandBarRememberProps {
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
  recentNotes: SearchItem[];
  recentTasks: RecentTaskItem[];
  isSearching: boolean;
  onSearchInput: (value: string) => void;
  onSearchModeChange: (mode: SearchMode) => void | Promise<void>;
  onMatchCaseChange: (enabled: boolean) => void | Promise<void>;
  onMatchWholeWordChange: (enabled: boolean) => void | Promise<void>;
  onSearchSelect: (result: SearchItem) => void;
  onSearchNavigate?: (result: SearchItem) => void | Promise<void>;
  onRecentNoteSelect: (result: SearchItem) => void;
  onRecentTaskSelect: (task: RecentTaskItem) => void;
  onRecentNoteShortcut: (index: number) => void | Promise<void>;
  onRecentTaskShortcut: (index: number) => void | Promise<void>;
  onSearchOpen: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
}

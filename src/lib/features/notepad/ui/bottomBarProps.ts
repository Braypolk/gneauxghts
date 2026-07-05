import type { RecentTaskItem } from '$lib/features/notepad/model/types';
import type { SearchItem } from '$lib/types/semantic';

/**
 * Forget/unforget bundle: the chrome on the left of the bottom bar.
 */
export interface BottomBarForgetProps {
  canUnforget: boolean;
  onForget: () => void;
  onUnforget: () => void;
}

/**
 * Remember bundle: the action menu on the right of the bottom bar.
 */
export interface BottomBarRememberProps {
  onRemember: () => void;
}

/**
 * Search/results bundle: the central search input and result list.
 */
export interface BottomBarSearchProps {
  searchMode: 'current' | 'all';
  searchQuery: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  searchResults: SearchItem[];
  recentNotes: SearchItem[];
  recentTasks: RecentTaskItem[];
  isSearching: boolean;
  focusRequest: number;
  onSearchInput: (value: string) => void;
  onSearchModeChange: (mode: 'current' | 'all') => void | Promise<void>;
  onMatchCaseChange: (enabled: boolean) => void | Promise<void>;
  onMatchWholeWordChange: (enabled: boolean) => void | Promise<void>;
  onSearchSelect: (result: SearchItem) => void;
  onRecentNoteSelect: (result: SearchItem) => void;
  onRecentTaskSelect: (task: RecentTaskItem) => void;
  onRecentNoteShortcut: (index: number) => void | Promise<void>;
  onRecentTaskShortcut: (index: number) => void | Promise<void>;
  onSearchFocus: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
}

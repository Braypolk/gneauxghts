import type { RecentTaskItem } from '$lib/features/notepad/model/types';
import type { RememberActionOption } from '$lib/types/ai';
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
  rememberActions: RememberActionOption[];
  defaultRememberActionId: string;
  integrateEnabled: boolean;
  integrateDisabledReason: string | null;
  onRemember: (action: RememberActionOption) => void;
}

/**
 * Search/results bundle: the central search input and result list.
 */
export interface BottomBarSearchProps {
  searchMode: 'current' | 'all';
  searchQuery: string;
  searchResults: SearchItem[];
  recentNotes: SearchItem[];
  recentTasks: RecentTaskItem[];
  isSearching: boolean;
  focusRequest: number;
  onSearchInput: (value: string) => void;
  onSearchModeChange: (mode: 'current' | 'all') => void | Promise<void>;
  onSearchSelect: (result: SearchItem) => void;
  onRecentNoteSelect: (result: SearchItem) => void;
  onRecentTaskSelect: (task: RecentTaskItem) => void;
  onRecentNoteShortcut: (index: number) => void | Promise<void>;
  onRecentTaskShortcut: (index: number) => void | Promise<void>;
  onSearchFocus: () => void;
  onCommand?: (command: string) => boolean | Promise<boolean>;
}

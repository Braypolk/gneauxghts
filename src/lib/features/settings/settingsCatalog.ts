import type { GeneralSection } from './store.svelte';

export type SettingsCategory = GeneralSection | 'forgotten';

export const settingsCategories: { id: SettingsCategory; label: string; description: string; group: string }[] = [
  { id: 'appearance', label: 'Appearance', description: 'Make this space feel like yours.', group: 'Workspace' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', description: 'Your most-used actions, a keystroke away.', group: 'Workspace' },
  { id: 'forgetting', label: 'Forgetting', description: 'Choose how you let things go, and how long they stay recoverable.', group: 'Workspace' },
  { id: 'ai', label: 'AI & Chat', description: 'Choose your provider, set chat defaults, and control access to your notes.', group: 'Intelligence' },
  { id: 'search', label: 'Semantic search', description: 'Find connections with a search index that stays on your device.', group: 'Intelligence' },
  { id: 'vault', label: 'Vault', description: 'Manage where your notes live.', group: 'Storage & recovery' },
  { id: 'history', label: 'Note Timeline', description: 'Check history health, storage, and recovery options.', group: 'Storage & recovery' },
  { id: 'forgotten', label: 'Forgotten Items', description: 'Recover missing notes and bring back things you have forgotten.', group: 'Storage & recovery' }
];

export interface SettingsSearchEntry {
  id: string;
  category: SettingsCategory;
  title: string;
  description: string;
  keywords: string;
  /** A stable presentation anchor; searching never reads values or credentials. */
  anchor: string;
}

export const settingsSearchEntries: SettingsSearchEntry[] = [
  { id: 'theme', category: 'appearance', title: 'Theme', description: 'Choose Light, Dark, or Auto to follow your system.', keywords: 'color colour mode display night', anchor: 'theme' },
  { id: 'text-size', category: 'appearance', title: 'Editor text size', description: 'Adjust text size, custom body text, and heading scale with a live preview.', keywords: 'font typography zoom large small medium reading', anchor: 'text-size' },
  { id: 'shortcuts', category: 'shortcuts', title: 'Customize keyboard shortcuts', description: 'Change key bindings, resolve conflicts, or reset all to default.', keywords: 'hotkeys keybindings keys', anchor: 'shortcuts' },
  { id: 'forget-duration', category: 'forgetting', title: 'Forget button duration', description: 'Forget instantly or hold the button for a chosen duration.', keywords: 'timing delay seconds press', anchor: 'forget-duration' },
  { id: 'retention', category: 'forgetting', title: 'Forgotten note retention', description: 'Choose how long forgotten notes and chats remain recoverable.', keywords: 'trash delete purge days forever expiry', anchor: 'retention' },
  { id: 'api-keys', category: 'ai', title: 'Provider API keys', description: 'Save, replace, or remove the OpenAI or local provider credential.', keywords: 'token secret password authentication security lm studio', anchor: 'api-keys' },
  { id: 'provider', category: 'ai', title: 'Provider and defaults', description: 'Choose OpenAI or a local OpenAI-compatible provider.', keywords: 'ai chat hosted offline lm studio', anchor: 'chat-provider' },
  { id: 'model', category: 'ai', title: 'Chat model', description: 'Choose an OpenAI model or discover and select a local model.', keywords: 'llm gpt download load unload server', anchor: 'chat-model' },
  { id: 'endpoint', category: 'ai', title: 'Local endpoint', description: 'Set the server address when using a local provider.', keywords: 'url localhost lm studio base port', anchor: 'chat-endpoint' },
  { id: 'reasoning', category: 'ai', title: 'Reasoning', description: 'Choose the reasoning effort for supported OpenAI models.', keywords: 'thinking effort intelligence', anchor: 'chat-reasoning' },
  { id: 'processing', category: 'ai', title: 'Processing', description: 'Choose Standard or lower-cost Flex processing with OpenAI.', keywords: 'price pricing cost speed service tier', anchor: 'chat-processing' },
  { id: 'web', category: 'ai', title: 'OpenAI web access', description: 'Allow automatic web search or turn it off by default.', keywords: 'internet online browsing', anchor: 'chat-web' },
  { id: 'access', category: 'ai', title: 'Default vault access', description: 'Choose None, Approved only, or Full access for chat.', keywords: 'privacy permissions scope notes', anchor: 'chat-access' },
  { id: 'visibility', category: 'ai', title: 'Map chat visibility', description: 'Show all chats, remembered chats, or hide chats on the map.', keywords: 'atlas graph conversations', anchor: 'chat-visibility' },
  { id: 'excluded', category: 'ai', title: 'Excluded notes', description: 'Find notes to exclude from AI, or allow previously excluded notes.', keywords: 'privacy private security hide block permissions', anchor: 'excluded-notes' },
  { id: 'semantic', category: 'search', title: 'Semantic search', description: 'Blend local semantic matches into keyword search.', keywords: 'enable disable toggle embeddings related', anchor: 'semantic-search' },
  { id: 'embedding', category: 'search', title: 'Embedding model', description: 'Check whether the local embedding model is installed.', keywords: 'install runtime dimensions offline', anchor: 'semantic-model' },
  { id: 'index', category: 'search', title: 'Search index', description: 'Check search readiness and any required setup steps.', keywords: 'status health chunks ann model available ready setup attention retry recovery', anchor: 'semantic-actions' },
  { id: 'automatic-indexing', category: 'search', title: 'Automatic indexing', description: 'Pause or resume background updates when notes change.', keywords: 'maintenance index indexing pause resume automatic background', anchor: 'semantic-background' },
  { id: 'download-model', category: 'search', title: 'Set up local search', description: 'Install or verify the runtime and model used for local search.', keywords: 'maintenance install offline download embedding runtime llama setup', anchor: 'semantic-download' },
  { id: 'prepare-model', category: 'search', title: 'Prepare local model', description: 'Manually start or retry the embedding model.', keywords: 'maintenance runtime warmup prepare embedding', anchor: 'semantic-prepare' },
  { id: 'rebuild-index', category: 'search', title: 'Rebuild semantic index', description: 'Reprocess notes and rebuild semantic matches.', keywords: 'maintenance reset search embeddings', anchor: 'semantic-rebuild' },
  { id: 'cache', category: 'search', title: 'Clear map cache', description: 'Regenerate map positions and layout on the next Map open.', keywords: 'atlas graph reset', anchor: 'semantic-cache' },
  { id: 'diagnostics', category: 'search', title: 'Search diagnostics', description: 'Inspect, refresh, and clear semantic telemetry and recent events when available.', keywords: 'debug metrics performance failures latency runtime ann vector chunks dimensions files path repository', anchor: 'semantic-diagnostics' },
  { id: 'vault', category: 'vault', title: 'Vault folder', description: 'Choose a folder, use the default, or create a vault on supported devices.', keywords: 'directory path location files storage iphone', anchor: 'vault-folder' },
  { id: 'vault-details', category: 'vault', title: 'Vault folder details', description: 'View the Running Vault, forgotten items folder, and note count.', keywords: 'path directory location statistics stats running', anchor: 'vault-details' },
  { id: 'restart', category: 'vault', title: 'Next-launch Vault Selection', description: 'Apply a vault folder for the next launch and restart when ready.', keywords: 'switch change restart running vault', anchor: 'vault-folder' },
  { id: 'health', category: 'history', title: 'History health and recovery', description: 'Check Note Timeline integrity and retry or reset when recovery is needed.', keywords: 'repair corrupt unavailable revisions', anchor: 'history-health' },
  { id: 'storage', category: 'history', title: 'History storage', description: 'Review allocated and reclaimable Note Timeline storage.', keywords: 'disk space bytes size compaction', anchor: 'history-health' },
  { id: 'clear-history', category: 'history', title: 'Clear vault history', description: 'Remove retained history for active notes after confirmation.', keywords: 'delete revisions baseline timeline', anchor: 'clear-history' },
  { id: 'forgotten', category: 'forgotten', title: 'Restore or delete forgotten items', description: 'Select forgotten notes and chats to restore or permanently delete.', keywords: 'trash recycle bin recover undo forgetting', anchor: 'forgotten-items' },
  { id: 'missing', category: 'forgotten', title: 'Missing Notes', description: 'Inspect retained revisions and recover files deleted outside the app.', keywords: 'restore recover external deletion timeline', anchor: 'missing-notes' }
];

function normalize(value: string) {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function searchSettings(query: string, entries = settingsSearchEntries): SettingsSearchEntry[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);
  return entries
    .map((entry, index) => {
      const title = normalize(entry.title);
      const category = settingsCategories.find((item) => item.id === entry.category)!;
      const text = normalize(`${entry.title} ${entry.description} ${entry.keywords} ${category.label}`);
      const matches = terms.every((term) => text.includes(term));
      const score = title === normalized ? 100 : title.includes(normalized) ? 50 : terms.filter((term) => title.includes(term)).length;
      return { entry, index, matches, score };
    })
    .filter((item) => item.matches)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
}

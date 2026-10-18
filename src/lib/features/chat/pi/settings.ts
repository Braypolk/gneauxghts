import { invoke } from './nativeInvoke';
import type { VaultWritePolicy } from './authority';
import type { ChatSettings, ChatProvider, ChatKeyStatus, LocalModel, ChatModelCapabilities, LocalModelCapabilitySelection, ChatNotePolicy, ChatNoteCandidate } from '../types';
type ChatDefaults = ChatSettings;
type NativeSettings = Omit<ChatSettings, 'defaultVaultAccess'> & { defaultAccess: ChatSettings['defaultVaultAccess'] };
const normalize = (settings: NativeSettings): ChatSettings => {
  const { defaultAccess, ...rest } = settings;
  return { ...rest, defaultVaultAccess: defaultAccess };
};
/** Settings and credential status only; no ordinary chat lifecycle compatibility interface. */
export const chatSettings = {
  getWriteDefaults: () => invoke<VaultWritePolicy>('pi_chat_get_write_defaults'),
  setWriteDefaults: (write: VaultWritePolicy) => invoke<VaultWritePolicy>('pi_chat_set_write_defaults', { write }),
  async getSettings() { return normalize(await invoke<NativeSettings>('chat_get_settings')); },
  async setDefaults(settings: ChatDefaults) {
    const { defaultVaultAccess, ...rest } = settings;
    return normalize(await invoke<NativeSettings>('chat_set_defaults', { defaults: { ...rest, defaultAccess: defaultVaultAccess } }));
  },
  getKeyStatus: (provider: string) => invoke<ChatKeyStatus>('chat_get_key_status', { provider }),
  setApiKey: (provider: string, apiKey: string) => invoke<ChatKeyStatus>('chat_set_api_key', { provider, apiKey }),
  listLocalModels: (baseUrl: string) => invoke<LocalModel[]>('chat_list_local_models', { baseUrl }),
  listOpenAiModels: () => invoke<LocalModel[]>('chat_list_openai_models'),
  getModelCapabilities: (provider: ChatProvider, model: string, baseUrl?: string) => invoke<ChatModelCapabilities>('chat_get_model_capabilities', { provider, model, ...(baseUrl ? { baseUrl } : {}) }),
  setLocalModelCapabilities: (model: string, capabilities: LocalModelCapabilitySelection) => invoke<LocalModelCapabilitySelection>('chat_set_local_model_capabilities', { model, capabilities }),
  listNotePolicies: () => invoke<ChatNotePolicy[]>('chat_list_note_policies'),
  searchNotesForPolicy: (query: string, limit = 12) => invoke<ChatNoteCandidate[]>('chat_search_policy_notes', { query, limit }),
  setNoteExcluded: async (noteId: string, excluded: boolean) => { await invoke('pi_chat_set_exclusion', { noteId, excluded }); }
};

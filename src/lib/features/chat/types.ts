export type VaultAccess = 'none' | 'full';

export type ChatProvider = 'openai' | 'local';

export type ChatReasoningEffort = string;



export type ChatServiceTier = 'standard' | 'flex';

export interface ChatSettings {
  provider: ChatProvider;
  model: string;
  openaiModel: string;
  localModel: string;
  localBaseUrl: string;
  reasoningEffort: ChatReasoningEffort;
  serviceTier: ChatServiceTier;
  defaultVaultAccess: VaultAccess;
}

export interface ChatKeyStatus {
  provider: string;
  configured: boolean;
}

export interface LocalModel {
  id: string;
  ownedBy: string | null;
}

export interface ChatModelCapabilities {
  images: boolean;
  audio: boolean;
  video: boolean;
  files: boolean;
  acceptedMimeTypes: string[];
  tools: boolean;
  defaultReasoningEffort?: ChatReasoningEffort | null;
  reasoningOptions?: ChatReasoningEffort[];
  serverReasoningDefault?: ChatReasoningEffort | null;
}

export interface LocalModelCapabilitySelection {
  images: boolean;
  tools: boolean;
  audio: boolean;
  video: boolean;
  reasoningEffort: ChatReasoningEffort;
}

export interface ChatNotePolicy {
  noteId: string;
  notePath: string | null;
  title: string;
  disposition: 'excluded';
  updatedAtMillis: number;
}

export interface ChatNoteCandidate {
  noteId: string;
  notePath: string;
  title: string;
}

export interface ChatSurfaceHandle {
  focusComposer(): boolean;
}

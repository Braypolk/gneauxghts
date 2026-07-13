export type ChatMode = 'auto' | 'explore' | 'challenge' | 'research' | 'make';
export type VaultAccess = 'none' | 'limited' | 'full';
export type ChatStatus = 'active' | 'archived' | 'projectionConflict';
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'cancelled' | 'error';
export type ChatRole = 'user' | 'assistant' | 'system';
export type DocumentKind = 'note' | 'chatIndex' | 'chatTranscript';
export type SearchScope = 'notes' | 'chats' | 'everything';
export type AtlasChatVisibility = 'hidden' | 'remembered' | 'all';

export interface ChatSettings {
  provider: string;
  model: string;
  defaultMode: ChatMode;
  defaultVaultAccess: VaultAccess;
  atlasVisibility: AtlasChatVisibility;
}

export interface ChatKeyStatus {
  provider: string;
  configured: boolean;
  displayHint: string | null;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  status: ChatStatus;
  mode: ChatMode;
  vaultAccess: VaultAccess;
  createdAtMillis: number;
  updatedAtMillis: number;
  messageCount: number;
  lastMessagePreview: string | null;
}

export type ChatCitation =
  | {
      id: string;
      kind: 'note';
      label: string;
      noteId: string;
      notePath: string;
      sectionLabel: string | null;
      startLine: number | null;
      excerpt: string | null;
      url?: never;
    }
  | {
      id: string;
      kind: 'web';
      label: string;
      url: string;
      excerpt: string | null;
      noteId?: never;
      notePath?: never;
      sectionLabel?: never;
      startLine?: never;
    };

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  status: MessageStatus;
  createdAtMillis: number;
  updatedAtMillis: number;
  requestId: string | null;
  errorMessage: string | null;
  citations: ChatCitation[];
  linkTarget: string | null;
}

export interface ChatConversation extends ChatConversationSummary {
  messages: ChatMessage[];
  activeRequestId: string | null;
  projectionPath: string | null;
}

export interface ChatExcerpt {
  id: string;
  conversationId: string;
  messageId: string;
  text: string;
  linkTarget: string;
  remembered: boolean;
  createdAtMillis: number;
}

export interface ChatNoteGrant {
  noteId: string;
  notePath: string;
  noteTitle: string;
  grantedAtMillis: number;
}

export interface ChatContextNote {
  noteId: string | null;
  notePath: string | null;
  noteTitle: string;
}

export type ProjectionConflictResolution = 'convertToNote' | 'restoreTranscript';

export interface ChatSendReceipt {
  requestId: string;
  conversationId: string;
  userMessage: ChatMessage;
  assistantMessage?: ChatMessage | null;
}

export interface ChatStreamIdentity {
  requestId: string;
  conversationId: string;
  messageId: string;
}

export interface ChatStartedEvent extends ChatStreamIdentity {
  message: ChatMessage;
}

export interface ChatTextDeltaEvent extends ChatStreamIdentity {
  delta: string;
}

export interface ChatSourceEvent extends ChatStreamIdentity {
  citation: ChatCitation;
}

export interface ChatCompletedEvent extends ChatStreamIdentity {
  message: ChatMessage;
  conversation?: ChatConversationSummary | null;
}

export interface ChatCancelledEvent extends ChatStreamIdentity {
  message: ChatMessage;
}

export interface ChatFailedEvent extends ChatStreamIdentity {
  message: ChatMessage;
  error: string;
  retryable: boolean;
}

export interface ChatSelection {
  conversationId: string;
  messageId: string;
  text: string;
  linkTarget: string | null;
}

export interface ChatSelectionActions {
  onCopy?: (selection: ChatSelection) => void | Promise<void>;
  onCopyLink?: (selection: ChatSelection) => void | Promise<void>;
  onInsertIntoNote?: (selection: ChatSelection) => void | Promise<void>;
  onRemember?: (selection: ChatSelection, excerpt: ChatExcerpt) => void | Promise<void>;
  onUnremember?: (selection: ChatSelection, excerpt: ChatExcerpt) => void | Promise<void>;
}

export interface ChatEventMap {
  'chat://started': ChatStartedEvent;
  'chat://text-delta': ChatTextDeltaEvent;
  'chat://source': ChatSourceEvent;
  'chat://completed': ChatCompletedEvent;
  'chat://cancelled': ChatCancelledEvent;
  'chat://failed': ChatFailedEvent;
}

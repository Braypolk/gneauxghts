export type VaultAccess = 'none' | 'approved' | 'full';
export type ChatProvider = 'openai' | 'local';
export type ChatReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type WebAccess = 'off' | 'auto';
export type ChatStatus = 'active' | 'archived' | 'projectionConflict';
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'cancelled' | 'error';
export type ChatRole = 'user' | 'assistant' | 'system';
export type DocumentKind = 'note' | 'chatIndex' | 'chatTranscript';
export type AtlasChatVisibility = 'hidden' | 'remembered' | 'all';
export type ChatServiceTier = 'standard' | 'flex';
export type DurableProposalStatus =
  | 'pending'
  | 'committing'
  | 'committed'
  | 'conflict'
  | 'dismissed'
  | 'superseded';

export type AgentToolStatus =
  | 'running'
  | 'success'
  | 'error'
  | 'denied'
  | 'skipped';

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  toolUsePromptTokens: number;
  reasoningTokens: number;
}

export interface AgentPlanEntry {
  id: string;
  text: string;
  status: 'pending' | 'inProgress' | 'completed';
  detail?: string;
}

export type AgentPermissionKind =
  | 'processExecution'
  | 'fileMutation'
  | 'networkMutation'
  | 'destructiveAction';
export type AgentPermissionDecision = 'allowOnce' | 'allowForSession' | 'deny';
export type AgentPermissionResolution =
  | 'allowedOnce'
  | 'allowedForSession'
  | 'denied'
  | 'cancelled';

export interface AgentPermissionIdentity {
  permissionId: string;
  requestId: string;
  conversationId: string;
  messageId: string;
  runId: string;
  toolCallId: string;
}

export interface AgentPermissionRequest extends AgentPermissionIdentity {
  toolName: string;
  title: string;
  kind: AgentPermissionKind;
  scope: string;
}

export type AgentEvent =
  | { type: 'textDelta'; delta: string }
  | {
      type: 'toolCallUpdated';
      callId: string;
      name: string;
      title: string;
      status: AgentToolStatus;
      stepIndex?: number;
      inputSummary?: string;
      outputSummary?: string;
      durationMillis?: number;
    }
  | {
      type: 'stepUpdated';
      index: number;
      status: 'running' | 'completed' | 'error';
      usage?: AgentUsage;
    }
  | { type: 'runGuardTriggered'; reason: string; message: string }
  | { type: 'proposalLinked'; proposalId: string; title: string; kind: 'update' | 'create' }
  | { type: 'contextUpdated'; compacted: boolean; selectedNoteTitles: string[] }
  | { type: 'planUpdated'; entries: AgentPlanEntry[] }
  | { type: 'usageUpdated'; callIndex: number; aggregate: AgentUsage }
  | { type: 'queryResolved'; details: Record<string, unknown> }
  | { type: 'researchCompleted'; details: Record<string, unknown> }
  | { type: 'contextMeasured'; details: Record<string, unknown> }
  | { type: 'modelTurnRetried'; turn: number }
  | { type: 'permissionRequested'; request: AgentPermissionRequest }
  | {
      type: 'permissionResolved';
      permissionId: string;
      resolution: AgentPermissionResolution;
    };

export interface ChatAgentEventEnvelope {
  schemaVersion?: number;
  requestId: string;
  conversationId: string;
  messageId: string;
  runId: string;
  sequence: number;
  createdAtMillis: number;
  event: AgentEvent;
}

export type ChatPart =
  | { id: 'text'; type: 'text'; text: string }
  | {
      id: string;
      type: 'tool';
      callId: string;
      name: string;
      title: string;
      status: AgentToolStatus;
      stepIndex?: number;
      inputSummary?: string;
      outputSummary?: string;
      durationMillis?: number;
    }
  | { id: 'plan'; type: 'plan'; entries: AgentPlanEntry[] }
  | { id: 'usage'; type: 'usage'; callIndex: number; usage: AgentUsage }
  | {
      id: 'retry';
      type: 'status';
      status: 'retrying';
      turn: number;
      label: string;
    }
  | {
      id: 'run-guard';
      type: 'status';
      status: 'stopped';
      reason: string;
      label: string;
    }
  | {
      id: string;
      type: 'proposalRef';
      proposalId: string;
      title: string;
      kind: 'update' | 'create';
    }
  | {
      id: 'context';
      type: 'context';
      compacted: boolean;
      selectedNoteTitles: string[];
    }
  | { id: 'sources'; type: 'sources'; citations: ChatCitation[] }
  | {
      id: 'checkpoint';
      type: 'checkpoint';
      label: string;
    }
  | {
      id: string;
      type: 'permission';
      request: AgentPermissionRequest;
      status: 'pending' | 'resolved';
      resolution?: AgentPermissionResolution;
    };

export interface ChatSettings {
  provider: ChatProvider;
  model: string;
  openaiModel: string;
  localModel: string;
  localBaseUrl: string;
  reasoningEffort: ChatReasoningEffort;
  serviceTier: ChatServiceTier;
  webAccess: WebAccess;
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
  vaultAccess: VaultAccess;
  createdAtMillis: number;
  updatedAtMillis: number;
  messageCount: number;
  lastMessagePreview: string | null;
  provider: ChatProvider;
  model: string;
  reasoningEffort: ChatReasoningEffort;
}

export interface ChatActiveNoteSnapshot {
  noteId: string | null;
  title: string;
  path: string | null;
  body: string;
  bodyHash: string;
  selection: string | null;
}

export interface LocalModel {
  id: string;
  ownedBy: string | null;
}

export type ChatAttachmentKind = 'image' | 'file';

export interface ChatAttachmentInput {
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
}

export interface ChatAttachment extends ChatAttachmentInput {
  id: string;
}

export interface ChatModelCapabilities {
  images: boolean;
  audio: boolean;
  video: boolean;
  files: boolean;
  acceptedMimeTypes: string[];
  tools: boolean;
  defaultReasoningEffort?: ChatReasoningEffort | null;
}

export interface LocalModelCapabilitySelection {
  images: boolean;
  tools: boolean;
  audio: boolean;
  video: boolean;
  reasoningEffort: ChatReasoningEffort;
}

export interface ChatAgentProposal {
  id: string;
  runId: string;
  conversationId: string;
  assistantMessageId: string;
  kind: 'update' | 'create';
  noteId: string | null;
  suggestedPath: string | null;
  title: string;
  baseHash: string | null;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  status: DurableProposalStatus;
  createdAtMillis: number;
  updatedAtMillis: number;
}

export interface ChatNotePolicy {
  noteId: string;
  notePath: string | null;
  title: string;
  disposition: 'approved' | 'excluded';
  updatedAtMillis: number;
}

export interface ChatNoteCandidate {
  noteId: string;
  notePath: string;
  title: string;
}

export interface RevisionCitation {
  noteId: string;
  revisionId: string;
  atMillis: number;
  timeEvidence?: import('$lib/types/history').RevisionTimeEvidence;
  source: import('$lib/features/history/historyModeMachine').HistoryMutationSource;
  currentExcerpt: string;
}

export interface PassageCitation {
  id: string; noteId: string; contentHash: string; location: string;
  start: number; end: number; excerpt: string; revisions: RevisionCitation[];
  historical?: { revisionId: string; contentRevisionId: string; changeKind: string; timeEvidence: import('$lib/types/history').RevisionTimeEvidence; source: import('$lib/features/history/historyModeMachine').HistoryMutationSource };
}

export type ChatCitation =
  | {
      id: string;
      kind: 'note';
      revision?: RevisionCitation;
      passage?: PassageCitation;
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
  attachments: ChatAttachment[];
  linkTarget: string | null;
  parts: ChatPart[];
  agentRunId: string | null;
  agentSequence: number;
  agentEventCreatedAtMillis: number;
  agentRetiredRunIds: string[];
}

export interface ChatConversation extends ChatConversationSummary {
  messages: ChatMessage[];
  activeRequestId: string | null;
  projectionPath: string | null;
  excerptMessageIds: Record<string, string>;
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

export interface ChatContextSuggestion {
  noteId: string;
  title: string;
  sectionLabel: string | null;
  excerpt: string;
  startLine: number | null;
  endLine: number | null;
  blockAnchor: string | null;
  reason: 'related' | 'explicit';
}

export interface ChatContextSuggestionResponse {
  status: 'ready' | 'insufficientContent' | 'unavailable';
  reason: string | null;
  items: ChatContextSuggestion[];
}

export interface ChatContextSelectionInput {
  noteId: string;
  sectionLabel?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  blockAnchor?: string | null;
  reason?: 'related' | 'explicit';
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
  conversation?: ChatConversationSummary | null;
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

export interface ChatTitleUpdatedEvent {
  conversationId: string;
  conversation: ChatConversationSummary;
}

export interface ChatCancelledEvent extends ChatStreamIdentity {
  message: ChatMessage;
}

export interface ChatFailedEvent extends ChatStreamIdentity {
  message: ChatMessage;
  error: string;
  retryable: boolean;
}

export interface ChatProjectionConflictEvent {
  conversationId: string;
  notePath: string;
  deleted: boolean;
}

export interface ChatActivityEvent extends ChatStreamIdentity {
  runId: string;
  status: string;
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

/**
 * Imperative capability exposed by a mounted ChatPanel without leaking its DOM.
 */
export interface ChatSurfaceHandle {
  focusComposer(): boolean;
}

export interface ChatEventMap {
  'chat://started': ChatStartedEvent;
  'chat://text-delta': ChatTextDeltaEvent;
  'chat://source': ChatSourceEvent;
  'chat://completed': ChatCompletedEvent;
  'chat://title-updated': ChatTitleUpdatedEvent;
  'chat://cancelled': ChatCancelledEvent;
  'chat://failed': ChatFailedEvent;
  'chat://activity': ChatActivityEvent;
  'chat://agent-event': ChatAgentEventEnvelope;
  'chat://proposal': ChatAgentProposal;
  'chat://projection-conflict': ChatProjectionConflictEvent;
}

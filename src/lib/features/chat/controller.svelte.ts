import { ListenerScope } from '$lib/app/listenerScope';
import type { Readable, Subscriber, Unsubscriber } from 'svelte/store';
import { chatApi, type ChatApi } from './api';
import type { ChatConversation, ChatConversationSummary, ChatEventMap, ChatExcerpt, ChatMessage, ChatNoteGrant, ChatNotePolicy, ChatAgentProposal, ChatActiveNoteSnapshot, ChatAttachmentInput, ChatContextSelectionInput, ChatContextSuggestionResponse, ChatModelCapabilities, ChatProvider, ChatReasoningEffort, VaultAccess, ChatSettings, ChatSendReceipt, AgentPermissionDecision, AgentPermissionIdentity, LocalModel } from './types';
import type { CommitNoteReviewResult } from '$lib/types/proposals';
import type { ForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
import type { ForgottenNoteSummary } from '$lib/types/forgottenNotes';
import { configuredChatModel, normalizeChatReasoningEffort } from './chatConfiguration';
import { createChatControllerMachineState, transitionChatControllerMachine, projectChatController, draftConfiguration, isChatRequestBusy, isChatSelectionBusy, type ChatControllerMachineEvent, type ChatControllerState, type BackendChatEvent } from './machines/controllerMachine';
export type { ChatControllerState } from './machines/controllerMachine';
export interface ChatSendInput {
  content: string;
  title?: string;
  attachments?: ChatAttachmentInput[];
  forceWebSearch?: boolean;
  activeNote?: ChatActiveNoteSnapshot | null;
  selectedContext?: ChatContextSelectionInput[];
}
export type ChatSendOutcome = {
  status: 'sent';
  conversationId: string;
  selectionRevision: number;
  draftRevision: number | null;
} | {
  status: 'failed' | 'obsolete';
};
export interface ChatController extends Readable<ChatControllerState> {
  getSnapshot(): ChatControllerState;
  initialize(conversationId?: string | null): Promise<void>;
  dispose(): void;
  refreshList(): Promise<void>;
  startNewConversation(input?: {
    title?: string;
  }): void;
  setConversationDraftTitle(title: string): void;
  getComposerDraft(slot: string): Promise<string>;
  setComposerDraft(slot: string, body: string): Promise<void>;
  renameConversation(title: string): Promise<boolean>;
  archiveConversation(conversationId?: string, retentionDays?: ForgottenNoteRetentionPreference): Promise<ForgottenNoteSummary | null>;
  openConversation(conversationId: string): Promise<ChatConversation | null>;
  resolveProjectionConflict(resolution: 'convertToNote' | 'restoreTranscript'): Promise<boolean>;
  branchFromMessage(messageId: string): Promise<ChatConversation | null>;
  send(input: ChatSendInput): Promise<ChatSendOutcome>;
  suggestContext(input: {
    query: string;
    vaultAccess: VaultAccess;
    excludeNoteId?: string | null;
    limit?: number;
  }): Promise<ChatContextSuggestionResponse>;
  cancel(): Promise<void>;
  decidePermission(identity: AgentPermissionIdentity, decision: AgentPermissionDecision): Promise<boolean>;
  retry(messageId: string): Promise<void>;
  setVaultAccess(vaultAccess: VaultAccess): Promise<void>;
  setProvider(provider: ChatProvider, model: string): Promise<void>;
  setReasoningEffort(reasoningEffort: ChatReasoningEffort): Promise<void>;
  listOpenAiModels(): Promise<LocalModel[]>;
  listLocalModels(): Promise<LocalModel[]>;
  keepProposal(proposalId: string, markdown?: string): Promise<CommitNoteReviewResult>;
  dismissProposal(proposalId: string): Promise<void>;
  acceptProposal(proposal: ChatAgentProposal): void;
  recordSavedNote(messageId: string, noteId: string, path: string): void;
  removeResolvedProposal(proposalId: string): void;
  setNoteExcluded(noteId: string, title: string, excluded: boolean): Promise<void>;
  grantNote(noteId: string): Promise<void>;
  revokeNote(noteId: string): Promise<void>;
  createExcerpt(messageId: string, text: string): Promise<ChatExcerpt>;
  rememberExcerpt(excerptId: string): Promise<ChatExcerpt>;
  remember(messageId: string, text: string): Promise<ChatExcerpt>;
  unremember(excerptId: string): Promise<ChatExcerpt>;
  clearError(): void;
}
function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim())
    return error;
  if (error instanceof Error && error.message.trim())
    return error.message;
  return fallback;
}
export interface ChatControllerOptions {
  /**
  * Fired after a successful assistant completion for the open conversation.
  * Used to lift structured note proposals into the review session.
  */
  onAssistantCompleted?: (info: {
    conversation: ChatConversation;
    message: ChatMessage;
  }) => void | Promise<void>;
  /** Announces a durable proposal available for passive editor display. */
  onProposalAvailable?: (proposal: ChatAgentProposal) => void | Promise<void>;
  onRequestedProposal?: (proposal: ChatAgentProposal) => void | Promise<void>;
  onProposalResolved?: (proposalId: string) => void;
}
const chatChannels = {
  'chat://started': true,
  'chat://text-delta': true,
  'chat://answer-draft': true,
  'chat://source': true,
  'chat://completed': true,
  'chat://title-updated': true,
  'chat://cancelled': true,
  'chat://failed': true,
  'chat://activity': true,
  'chat://agent-event': true,
  'chat://proposal': true,
  'chat://projection-conflict': true
} satisfies Record<keyof ChatEventMap, true>;
/** The state transition admits and projects data atomically; this owner performs effects. */
export class ChatControllerStore implements ChatController {
  #state = createChatControllerMachineState();

  #api: ChatApi;

  #options: ChatControllerOptions;

  #subscribers = new Set<Subscriber<ChatControllerState>>();

  #listenerScope: ListenerScope | null = null;

  #listenerPromise: Promise<void> | null = null;

  #operationSequence = 0;

  #capabilitiesByModel = new Map<string, ChatModelCapabilities>();

  constructor(api: ChatApi = chatApi, options: ChatControllerOptions = {}) {
    this.#api = api;
    this.#options = options;
  }

  private get settings() { return this.#state.settings; }

  private get conversation() { return this.#state.conversation; }

  private get conversations() { return this.#state.conversations; }

  private get conversationDraft() { return this.#state.conversationDraft; }

  private get grants() { return this.#state.grants; }

  private get policies() { return this.#state.policies; }

  private get proposals() { return this.#state.proposals; }

  private get isSending() { return isChatRequestBusy(this.#state); }

  private get isLoadingConversation() { return isChatSelectionBusy(this.#state); }

  #isDisposed() { return this.#state.lifecycle.kind === 'disposed'; }

  #isInitializationCurrent(sequence: number) {
    return this.#state.lifecycle.kind === 'initializing' && this.#state.lifecycle.sequence === sequence;
  }

  getSnapshot(): ChatControllerState { return projectChatController(this.#state); }

  subscribe(run: Subscriber<ChatControllerState>): Unsubscriber {
    run(this.getSnapshot());
    this.#subscribers.add(run);
    return () => { this.#subscribers.delete(run); };
  }

  #dispatch(event: ChatControllerMachineEvent) {
    const previous = this.#state;
    const admitted = transitionChatControllerMachine(previous, event);
    if (admitted === previous)
      return null;
    this.#state = admitted;
    if (!this.#isDisposed()) {
      const snapshot = this.getSnapshot();
      for (const run of this.#subscribers) {
        if (this.#state !== admitted)
          break;
        run(snapshot);
      }
    }
    return admitted;
  }

  #metadata(data: Partial<Pick<ChatControllerState, 'settings' | 'conversations' | 'grants' | 'policies' | 'error'>>) {
    return this.#dispatch({ type: 'metadata', data });
  }

  #receive<K extends keyof ChatEventMap>(channel: K, payload: ChatEventMap[K]) {
    if (channel === 'chat://projection-conflict') {
      if (this.conversation?.id === payload.conversationId)
        void this.openConversation(payload.conversationId);
      return;
    }
    const admitted = this.#dispatch({
      type: 'backend',
      channel,
      payload,
      now: Date.now()
    } as BackendChatEvent);
    if (!admitted)
      return;
    if (channel === 'chat://completed') {
      const event = payload as ChatEventMap['chat://completed'];
      if (admitted.conversation && event.message.role === 'assistant' && event.message.status === 'completed') {
        void this.#options.onAssistantCompleted?.({ conversation: admitted.conversation, message: event.message });
      }
    }
    else if (channel === 'chat://proposal') {
      const proposal = payload as ChatAgentProposal;
      if (proposal.payload.reviewIntent === 'requested') void this.#options.onRequestedProposal?.(proposal);
      else void this.#options.onProposalAvailable?.(proposal);
    }
  }

  #modelKey(provider: ChatProvider, model: string) {
    return `${provider}:${model}`;
  }

  async #getModelCapabilities(provider: ChatProvider, model: string) {
    const key = this.#modelKey(provider, model);
    const cached = this.#capabilitiesByModel.get(key);
    // Local profiles are editable in Settings, so refresh them instead of
    // allowing a controller-lived cache to hide a newly saved configuration.
    if (cached && provider !== 'local')
      return cached;
    const capabilities = await this.#api.getModelCapabilities(provider, model);
    this.#capabilitiesByModel.set(key, capabilities);
    return capabilities;
  }

  #reasoningEffortForModel(provider: ChatProvider, model: string, fallback: ChatReasoningEffort, capabilities: ChatModelCapabilities | null) {
    const configured = provider === 'local'
      ? capabilities?.defaultReasoningEffort ?? fallback
      : fallback;
    return normalizeChatReasoningEffort(provider, model, configured, capabilities);
  }

  async #loadDraftModelCapabilities(revision: number, provider: ChatProvider, model: string) {
    try {
      const capabilities = model ? await this.#getModelCapabilities(provider, model) : null;
      this.#dispatch({
        type: 'draftCapabilities',
        revision,
        provider,
        model,
        capabilities,
        effort: this.#reasoningEffortForModel(provider, model, this.conversationDraft.reasoningEffort, capabilities)
      });
    }
    catch (error) {
      this.#dispatch({
        type: 'draftCapabilities',
        revision,
        provider,
        model,
        capabilities: null,
        error: errorText(error, 'Unable to load attachment capabilities for this model.')
      });
    }
  }

  async refreshList() {
    if (this.#isDisposed())
      return;
    try {
      this.#metadata({ conversations: await this.#api.listConversations(false), error: null });
    }
    catch (error) {
      this.#metadata({ error: errorText(error, 'Unable to load conversations.') });
    }
  }

  async openConversation(conversationId: string) {
    const operationId = ++this.#operationSequence;
    if (!this.#dispatch({
      type: 'startLoading',
      conversationId,
      operationId
    }))
      return null;
    try {
      const conversation = await this.#api.getConversation(conversationId);
      const [proposals, capabilities] = await Promise.all([
        this.#api.listPendingProposals(conversationId),
        this.#getModelCapabilities(conversation.provider, conversation.model)
      ]);
      if (!this.#dispatch({
        type: 'selectionLoaded',
        operationId,
        conversation,
        proposals,
        capabilities
      }))
        return null;
      for (const proposal of proposals)
        void this.#options.onProposalAvailable?.(proposal);
      return conversation;
    }
    catch (error) {
      this.#dispatch({
        type: 'selectionFailed',
        operationId,
        error: errorText(error, 'Unable to open this conversation.')
      });
      return null;
    }
  }

  async resolveProjectionConflict(resolution: 'convertToNote' | 'restoreTranscript') {
    const id = this.conversation?.id;
    if (!id || this.isSending || this.#isDisposed()) return false;
    try {
      await this.#api.resolveProjectionConflict(id, resolution);
      return Boolean(await this.openConversation(id));
    } catch (error) {
      this.#metadata({ error: errorText(error, 'Unable to resolve the transcript conflict.') });
      return false;
    }
  }

  async branchFromMessage(messageId: string) {
    if (this.#isDisposed() || this.isSending)
      return null;
    const operationId = ++this.#operationSequence;
    this.#dispatch({ type: 'startBranching', operationId });
    try {
      const conversation = await this.#api.branchFromMessage(messageId);
      const capabilities = await this.#getModelCapabilities(conversation.provider, conversation.model);
      return this.#dispatch({
        type: 'selectionLoaded',
        operationId,
        conversation,
        capabilities,
        proposals: []
      }) ? conversation : null;
    }
    catch (error) {
      this.#dispatch({
        type: 'selectionFailed',
        operationId,
        error: errorText(error, 'Unable to create checkpoint branch.')
      });
      return null;
    }
  }

  async #createForSend(title?: string) {
    const operationId = ++this.#operationSequence;
    const draft = this.conversationDraft;
    this.#dispatch({ type: 'startCreating', operationId });
    try {
      const conversation = await this.#api.createConversation({
        title: title?.trim() || draft.title.trim() || undefined,
        vaultAccess: draft.vaultAccess,
        provider: draft.provider,
        model: draft.model,
        reasoningEffort: draft.reasoningEffort
      });
      const capabilities = await this.#getModelCapabilities(conversation.provider, conversation.model);
      const admitted = this.#dispatch({
        type: 'selectionLoaded',
        operationId,
        conversation,
        capabilities,
        proposals: [],
        draftRevision: draft.revision
      });
      return admitted ? { conversationId: conversation.id, selectionRevision: admitted.selectionRevision } : null;
    }
    catch (error) {
      this.#dispatch({
        type: 'selectionFailed',
        operationId,
        error: errorText(error, 'Unable to start a conversation.')
      });
      return null;
    }
  }

  startNewConversation(input: {
    title?: string;
  } = {}) {
    const configuration = draftConfiguration(this.settings);
    const capabilities = configuration.provider === 'local' ? null
      : this.#capabilitiesByModel.get(this.#modelKey(configuration.provider, configuration.model)) ?? null;
    if (!this.#dispatch({
      type: 'draftStarted',
      title: input.title?.trim() ?? '',
      capabilities
    }))
      return;
    void this.#loadDraftModelCapabilities(this.conversationDraft.revision, configuration.provider, configuration.model);
  }

  setConversationDraftTitle(title: string) {
    this.#dispatch({ type: 'draftChanged', changes: { title: title.trim() } });
  }

  getComposerDraft(slot: string) { return this.#api.getComposerDraft(slot); }

  setComposerDraft(slot: string, body: string) { return this.#api.setComposerDraft(slot, body); }

  async renameConversation(title: string) {
    if (this.#isDisposed())
      return false;
    const conversationId = this.conversation?.id;
    const nextTitle = title.trim();
    if (!conversationId || !nextTitle)
      return false;
    if (this.conversation?.title === nextTitle)
      return true;
    try {
      this.#dispatch({
        type: 'summaryReceived',
        summary: await this.#api.renameConversation(conversationId, nextTitle)
      });
      return true;
    }
    catch (error) {
      this.#metadata({ error: errorText(error, 'Unable to rename this conversation.') });
      return false;
    }
  }

  async archiveConversation(conversationId = this.conversation?.id, retentionDays: ForgottenNoteRetentionPreference = 7) {
    if (this.#isDisposed() || !conversationId || this.isSending)
      return null;
    const operationId = ++this.#operationSequence;
    this.#dispatch({
      type: 'startArchiving',
      conversationId,
      operationId
    });
    try {
      const forgottenItem = await this.#api.archiveConversation(conversationId, true, retentionDays);
      const current = this.conversation?.id === conversationId;
      if (!this.#dispatch({
        type: 'archived',
        operationId,
        conversationId
      }))
        return forgottenItem;
      if (current && this.conversations[0])
        await this.openConversation(this.conversations[0].id);
      else if (current) {
        const draft = this.conversationDraft;
        await this.#loadDraftModelCapabilities(draft.revision, draft.provider, draft.model);
      }
      return forgottenItem;
    }
    catch (error) {
      this.#dispatch({
        type: 'selectionFailed',
        operationId,
        error: errorText(error, 'Unable to forget this conversation.')
      });
      return null;
    }
  }

  async initialize(conversationId?: string | null) {
    const sequence = ++this.#operationSequence;
    if (!this.#dispatch({ type: 'initialize', sequence }))
      return;
    const selectionRevision = this.#state.selectionRevision;
    this.#metadata({ error: null });
    try {
      await this.#ensureListeners();
      if (!this.#isInitializationCurrent(sequence))
        return;
      const [settings, conversations, grants, policies] = await Promise.all([
        this.#api.getSettings(), this.#api.listConversations(false), this.#api.listGrants(), this.#api.listNotePolicies()
      ]);
      if (!this.#isInitializationCurrent(sequence))
        return;
      this.#metadata({
        settings,
        conversations,
        grants,
        policies
      });
      if (selectionRevision === this.#state.selectionRevision) {
        const targetId = conversationId ?? conversations[0]?.id ?? null;
        if (targetId)
          await this.openConversation(targetId);
        else {
          const configuration = draftConfiguration(settings);
          this.#dispatch({ type: 'draftChanged', changes: configuration });
          await this.#loadDraftModelCapabilities(this.conversationDraft.revision, configuration.provider, configuration.model);
        }
      }
      this.#dispatch({ type: 'initialized', sequence });
    }
    catch (error) {
      this.#dispatch({
        type: 'initializationFailed',
        sequence,
        error: errorText(error, 'Chat is unavailable right now.')
      });
    }
  }

  async send(input: ChatSendInput): Promise<ChatSendOutcome> {
    if (this.#isDisposed() || this.isSending || this.isLoadingConversation || (!input.content.trim() && !input.attachments?.length))
      return { status: 'failed' };
    if (!this.settings) {
      this.#metadata({ error: 'Chat settings are still loading. Try again in a moment.' });
      return { status: 'failed' };
    }
    const draftRevision = this.conversation ? null : this.conversationDraft.revision;
    const target = this.conversation
      ? { conversationId: this.conversation.id, selectionRevision: this.#state.selectionRevision }
      : await this.#createForSend(input.title);
    if (!target)
      return { status: 'failed' };
    const { conversationId, selectionRevision } = target;
    if (this.#isDisposed() || selectionRevision !== this.#state.selectionRevision || this.conversation?.id !== conversationId)
      return { status: 'obsolete' };
    const operationId = ++this.#operationSequence;
    if (!this.#dispatch({
      type: 'submit',
      conversationId,
      operationId,
      activity: 'Starting'
    }) || this.#isDisposed() || selectionRevision !== this.#state.selectionRevision)
      return { status: 'obsolete' };
    try {
      const receipt = await this.#api.sendMessage({
        conversationId,
        content: input.content.trim(),
        attachments: input.attachments ?? [],
        forceWebSearch: input.forceWebSearch ?? false,
        activeNote: input.activeNote,
        selectedContext: input.selectedContext ?? []
      });
      this.#dispatch({
        type: 'receipt',
        receipt,
        operationId,
        includeUser: true
      });
      return this.#state.selectionRevision === selectionRevision && !this.#isDisposed()
        ? {
          status: 'sent',
          conversationId,
          selectionRevision,
          draftRevision
        } : { status: 'obsolete' };
    }
    catch (error) {
      this.#dispatch({
        type: 'submissionFailed',
        conversationId,
        operationId,
        error: errorText(error, 'Unable to send this message.')
      });
      return { status: 'failed' };
    }
  }

  suggestContext(input: {
    query: string;
    vaultAccess: VaultAccess;
    excludeNoteId?: string | null;
    limit?: number;
  }) {
    if (this.#isDisposed())
      return Promise.reject(new Error('Chat controller is disposed.'));
    return this.#api.suggestContext({ ...input, conversationId: this.conversation?.id ?? null });
  }

  async cancel() {
    const request = this.#state.request;
    if (request.kind !== 'streaming' || !this.#dispatch({
      type: 'cancel',
      conversationId: request.conversationId,
      requestId: request.requestId
    }))
      return;
    try {
      await this.#api.cancelRequest(request.requestId);
    }
    catch (error) {
      this.#dispatch({
        type: 'cancelFailed',
        conversationId: request.conversationId,
        requestId: request.requestId,
        error: errorText(error, 'Unable to stop the response.')
      });
    }
  }

  #ensureListeners(): Promise<void> {
    if (this.#listenerPromise)
      return this.#listenerPromise;
    const scope = new ListenerScope();
    this.#listenerScope = scope;
    const attempt = Promise.all((Object.keys(chatChannels) as Array<keyof ChatEventMap>).map((event) => scope.acquire(() => this.#api.on(event, ((payload: never) => {
      if (!scope.closed)
        this.#receive(event, payload);
    }) as never)))).then(() => undefined).catch((error) => {
      scope.close();
      if (this.#listenerScope === scope)
        this.#listenerScope = null;
      if (this.#listenerPromise === attempt)
        this.#listenerPromise = null;
      throw error;
    });
    this.#listenerPromise = attempt;
    return attempt;
  }

  async decidePermission(identity: AgentPermissionIdentity, decision: AgentPermissionDecision) {
    if (this.#isDisposed())
      return false;
    const request = this.#state.request;
    const conversation = this.conversation;
    const message = conversation?.messages.find((candidate) => candidate.id === identity.messageId);
    const permission = message?.parts.find((part) => part.type === 'permission' &&
      part.request.permissionId === identity.permissionId);
    if (request.kind !== 'streaming' ||
      request.requestId !== identity.requestId ||
      request.conversationId !== identity.conversationId ||
      conversation?.id !== identity.conversationId ||
      conversation.activeRequestId !== identity.requestId ||
      message?.requestId !== identity.requestId ||
      message.agentRunId !== identity.runId ||
      !permission ||
      permission.type !== 'permission' ||
      permission.status !== 'pending' ||
      permission.request.toolCallId !== identity.toolCallId) {
      this.#metadata({ error: 'That permission request is no longer active.' });
      return false;
    }
    try {
      await this.#api.decidePermission(identity, decision);
      return true;
    }
    catch (error) {
      this.#metadata({
        error: errorText(error, 'Unable to decide this permission request.')
      });
      return false;
    }
  }

  async retry(messageId: string) {
    const conversationId = this.conversation?.id;
    if (this.#isDisposed() || this.isSending || !conversationId)
      return;
    const operationId = ++this.#operationSequence;
    if (!this.#dispatch({
      type: 'submit',
      conversationId,
      operationId
    }))
      return;
    try {
      this.#dispatch({
        type: 'receipt',
        receipt: await this.#api.retryMessage(messageId),
        operationId,
        includeUser: false
      });
    }
    catch (error) {
      this.#dispatch({
        type: 'submissionFailed',
        conversationId,
        operationId,
        error: errorText(error, 'Unable to retry this response.')
      });
    }
  }

  async setVaultAccess(vaultAccess: VaultAccess) {
    if (this.#isDisposed())
      return;
    const conversation = this.conversation;
    if (!conversation) {
      this.#dispatch({ type: 'draftChanged', changes: { vaultAccess } });
      return;
    }
    if (conversation.vaultAccess === vaultAccess)
      return;
    const selection = this.#state.selectionRevision;
    try {
      const summary = await this.#api.setConversationVaultAccess(conversation.id, vaultAccess);
      if (selection === this.#state.selectionRevision)
        this.#dispatch({ type: 'summaryReceived', summary });
    }
    catch (error) {
      if (selection === this.#state.selectionRevision)
        this.#metadata({ error: errorText(error, 'Unable to change vault access.') });
    }
  }

  async setProvider(provider: ChatProvider, model: string) {
    if (this.#isDisposed())
      return;
    if (this.isSending) {
      this.#metadata({ error: 'Wait for the current response to finish before changing models.' });
      return;
    }
    const conversation = this.conversation;
    const admitted = this.#dispatch({ type: 'configurationStarted' });
    if (!admitted || this.#state !== admitted) return;
    const revision = admitted.configurationRevision;
    const currentEffort = conversation?.reasoningEffort ?? this.conversationDraft.reasoningEffort;
    let capabilities = provider === 'local' ? null : this.#capabilitiesByModel.get(this.#modelKey(provider, model)) ?? null;
    if (provider === 'local') {
      try {
        capabilities = await this.#getModelCapabilities(provider, model);
      }
      catch { /* The selected model can still be persisted; report capability failure below. */ }
    }
    if (revision !== this.#state.configurationRevision || this.isSending || this.#isDisposed())
      return;
    const reasoningEffort = this.#reasoningEffortForModel(provider, model, currentEffort, capabilities);
    const changes = {
      provider,
      model,
      reasoningEffort
    };
    if (!conversation) {
      this.#dispatch({
        type: 'configurationReceived',
        revision,
        changes,
        capabilities
      });
      if (!capabilities)
        await this.#loadDraftModelCapabilities(this.conversationDraft.revision, provider, model);
      return;
    }
    if (conversation.provider === provider && conversation.model === model && conversation.reasoningEffort === reasoningEffort)
      return;
    try {
      const summary = await this.#api.setConversationProvider(conversation.id, provider, model, reasoningEffort);
      if (!this.#dispatch({
        type: 'configurationReceived',
        revision,
        changes: summary,
        capabilities
      }))
        return;
      try {
        capabilities ??= await this.#getModelCapabilities(provider, model);
        this.#dispatch({
          type: 'configurationReceived',
          revision,
          capabilities
        });
      }
      catch (error) {
        this.#dispatch({
          type: 'configurationReceived',
          revision,
          capabilities: null,
          error: errorText(error, 'The model changed, but its attachment capabilities could not be loaded.')
        });
      }
    }
    catch (error) {
      this.#dispatch({
        type: 'configurationReceived',
        revision,
        error: errorText(error, 'Unable to change the chat model.')
      });
    }
  }

  async setReasoningEffort(reasoningEffort: ChatReasoningEffort) {
    if (this.#isDisposed())
      return;
    if (this.isSending) {
      this.#metadata({ error: 'Wait for the current response to finish before changing reasoning.' });
      return;
    }
    const conversation = this.conversation;
    const admitted = this.#dispatch({ type: 'configurationStarted' });
    if (!admitted || this.#state !== admitted) return;
    const revision = admitted.configurationRevision;
    const provider = conversation?.provider ?? this.conversationDraft.provider;
    const model = conversation?.model ?? this.conversationDraft.model;
    const normalized = normalizeChatReasoningEffort(provider, model, reasoningEffort, this.#state.modelCapabilities);
    if (!conversation) {
      this.#dispatch({
        type: 'configurationReceived',
        revision,
        changes: { reasoningEffort: normalized }
      });
      return;
    }
    if (conversation.reasoningEffort === normalized)
      return;
    try {
      const summary = await this.#api.setConversationProvider(conversation.id, provider, model, normalized);
      this.#dispatch({
        type: 'configurationReceived',
        revision,
        changes: summary
      });
    }
    catch (error) {
      this.#dispatch({
        type: 'configurationReceived',
        revision,
        error: errorText(error, 'Unable to change reasoning effort.')
      });
    }
  }

  async listOpenAiModels(): Promise<LocalModel[]> {
    if (this.#isDisposed())
      return [];
    return this.#api.listOpenAiModels();
  }

  async listLocalModels(): Promise<LocalModel[]> {
    if (this.#isDisposed())
      return [];
    const baseUrl = this.settings?.localBaseUrl.trim();
    if (!baseUrl) {
      throw new Error('Configure a local model endpoint in Settings first.');
    }
    return this.#api.listLocalModels(baseUrl);
  }

  async keepProposal(proposalId: string, markdown?: string) {
    if (this.#isDisposed()) {
      throw new Error('Chat controller is disposed.');
    }
    try {
      const result = await this.#api.commitAgentProposal(proposalId, markdown);
      if (result.status === 'conflict') {
        this.#dispatch({
          type: 'proposalSettled',
          proposalId,
          conflict: true,
          error: result.message ?? 'The note changed before this proposal was kept.'
        });
        return result;
      }
      this.#dispatch({
        type: 'proposalSettled',
        proposalId,
        error: result.commitWarning?.message ?? null
      });
      if (result.commitWarning) {
        console.warn('Proposal was committed with incomplete projections:', result.commitWarning);
      }
      this.#options.onProposalResolved?.(proposalId);
      return result;
    }
    catch (error) {
      this.#metadata({ error: errorText(error, 'Unable to keep this proposal.') });
      throw error;
    }
  }

  async dismissProposal(proposalId: string) {
    if (this.#isDisposed()) {
      throw new Error('Chat controller is disposed.');
    }
    try {
      await this.#api.dismissAgentProposal(proposalId);
      this.#dispatch({ type: 'proposalSettled', proposalId });
      this.#options.onProposalResolved?.(proposalId);
    }
    catch (error) {
      this.#metadata({ error: errorText(error, 'Unable to dismiss this proposal.') });
      throw error;
    }
  }

  recordSavedNote(messageId: string, noteId: string, path: string) {
    this.#dispatch({type:'savedNoteLinked',messageId,noteId,path});
  }
  acceptProposal(proposal: ChatAgentProposal) {
    this.#dispatch({ type: 'backend', channel: 'chat://proposal', payload: proposal, now: Date.now() });
  }

  removeResolvedProposal(proposalId: string) {
    if (!this.proposals.some((proposal) => proposal.id === proposalId))
      return;
    this.#dispatch({ type: 'proposalSettled', proposalId });
  }

  async grantNote(noteId: string) {
    if (this.#isDisposed())
      return;
    try {
      const grant = await this.#api.grantNote(noteId);
      this.#metadata({
        grants: [...this.grants.filter((item) => item.noteId !== noteId), grant],
        policies: [
          ...this.policies.filter((item) => item.noteId !== noteId),
          {
            noteId,
            notePath: grant.notePath,
            title: grant.noteTitle,
            disposition: 'approved',
            updatedAtMillis: grant.grantedAtMillis
          }
        ],
        error: null
      });
    }
    catch (error) {
      const message = errorText(error, 'Unable to allow access to this note.');
      this.#metadata({ error: message });
      throw new Error(message);
    }
  }

  async revokeNote(noteId: string) {
    if (this.#isDisposed())
      return;
    try {
      await this.#api.revokeNote(noteId);
      this.#metadata({
        grants: this.grants.filter((item) => item.noteId !== noteId),
        policies: this.policies.filter((item) => item.noteId !== noteId || item.disposition !== 'approved'),
        error: null
      });
    }
    catch (error) {
      const message = errorText(error, 'Unable to remove access to this note.');
      this.#metadata({ error: message });
      throw new Error(message);
    }
  }

  async setNoteExcluded(noteId: string, title: string, excluded: boolean) {
    if (this.#isDisposed())
      return;
    try {
      await this.#api.setNoteExcluded(noteId, title, excluded);
      this.#metadata({
        grants: excluded
          ? this.grants.filter((item) => item.noteId !== noteId)
          : this.grants,
        policies: excluded
          ? [
            ...this.policies.filter((item) => item.noteId !== noteId),
            {
              noteId,
              notePath: null,
              title,
              disposition: 'excluded',
              updatedAtMillis: Date.now()
            }
          ]
          : this.policies.filter((item) => item.noteId !== noteId || item.disposition !== 'excluded'),
        error: null
      });
    }
    catch (error) {
      this.#metadata({ error: errorText(error, 'Unable to change the note exclusion.') });
      throw error;
    }
  }

  dispose() {
    const request = this.#state.request;
    const hasPendingPermission = this.conversation?.messages.some((message) => message.parts.some((part) => part.type === 'permission' && part.status === 'pending')) ?? false;
    if (hasPendingPermission &&
      (request.kind === 'streaming' || request.kind === 'cancelling')) {
      void this.#api.cancelRequest(request.requestId).catch(() => undefined);
    }
    this.#dispatch({ type: 'dispose' });
    this.#listenerScope?.close();
    this.#listenerScope = null;
    this.#listenerPromise = null;
    this.#subscribers.clear();
  }

  createExcerpt(messageId: string, text: string) {
    if (this.#isDisposed()) {
      return Promise.reject(new Error('Chat controller is disposed.'));
    }
    return this.#api.createExcerpt(messageId, text);
  }

  rememberExcerpt(excerptId: string) {
    if (this.#isDisposed()) {
      return Promise.reject(new Error('Chat controller is disposed.'));
    }
    return this.#api.rememberExcerpt(excerptId);
  }

  async remember(messageId: string, text: string) {
    if (this.#isDisposed()) {
      throw new Error('Chat controller is disposed.');
    }
    const excerpt = await this.#api.createExcerpt(messageId, text);
    return this.#api.rememberExcerpt(excerpt.id);
  }

  unremember(excerptId: string) {
    if (this.#isDisposed()) {
      return Promise.reject(new Error('Chat controller is disposed.'));
    }
    return this.#api.unrememberExcerpt(excerptId);
  }

  clearError() {
    this.#metadata({ error: null });
  }
}
export function createChatController(api: ChatApi = chatApi, options: ChatControllerOptions = {}): ChatController {
  return new ChatControllerStore(api, options);
}

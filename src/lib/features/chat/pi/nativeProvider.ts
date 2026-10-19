import { Channel } from '@tauri-apps/api/core';
import { invoke } from './nativeInvoke';
import { createModels, createProvider, createAssistantMessageEventStream, isContextOverflow, isRetryableAssistantError, type AssistantMessage, type Model, type ProviderStreams, type SimpleStreamOptions, type StreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import * as completions from '@earendil-works/pi-ai/api/openai-completions';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { modelLimits } from './modelLimits';
import type { AuthorityRef } from './authority';

export type ChatProvider = 'local' | 'openai';
export type NativeModelConfiguration = {
  provider: ChatProvider; model: string; contextWindow: number | null; maxTokens: number | null;
  images: boolean; tools: boolean; reasoningEffort: string; reasoningWireEffort: string | null;
};
export type NativeBinding = AuthorityRef & { conversationId: number; providerSessionId: string };
export type AdmitProviderMessage = (binding: NativeBinding, message: AssistantMessage) => Promise<AssistantMessage>;
/** Tunable application request allowance, not a claimed model output capacity. */
export const DEFAULT_GENERATION_MAX_TOKENS = 16384;
type NativeFrame = { type: 'headers'; status: number; content_type: string }
  | { type: 'chunk'; bytes: number[] } | { type: 'done' };

/** Fetch replacement only. URLs and request headers never select native credentials or routing. */
export function nativeFetch(binding: NativeBinding, provider: ChatProvider, model: string, onFailure?: (error: unknown) => void): typeof fetch {
  return async (_url, options) => {
    if (options?.method !== 'POST' || typeof options.body !== 'string') throw new Error('Invalid native inference request');
    const id = crypto.randomUUID();
    const response = Promise.withResolvers<Response>();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let terminal = false, headers = false;
    const cancel = () => { void invoke('pi_chat_cancel_fetch', { id }).catch(() => {}); };
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { terminal = true; cancel(); }
    });
    const fail = (error: unknown) => {
      if (terminal) return;
      terminal = true;
      onFailure?.(error);
      const failure = error instanceof DOMException ? error : new Error(safeFailure(error));
      response.reject(failure);
      if (headers) controller.error(failure); else controller.close();
    };
    const frames = new Channel<NativeFrame>();
    frames.onmessage = frame => {
      if (terminal) return;
      if (frame.type === 'headers') {
        headers = true;
        response.resolve(new Response(stream, { status: frame.status, headers: { 'content-type': frame.content_type } }));
      } else if (frame.type === 'chunk') controller.enqueue(Uint8Array.from(frame.bytes));
      else if (!headers) fail(new Error('Native stream ended before headers'));
      else { terminal = true; controller.close(); }
    };
    const abort = () => { cancel(); fail(new DOMException('Aborted', 'AbortError')); };
    if (options.signal?.aborted) { abort(); return response.promise; }
    options.signal?.addEventListener('abort', abort, { once: true });
    void invoke('pi_chat_fetch', { id, ...binding, provider, model, body: options.body, frames }).then(
      () => options.signal?.removeEventListener('abort', abort),
      error => { options.signal?.removeEventListener('abort', abort); fail(error); }
    );
    return response.promise;
  };
}

const nativeFailures: Record<string, string> = {
  provider_context_overflow: 'prompt is too long',
  provider_transient: 'network error: the model server is temporarily unavailable',
  provider_rate_limit: 'rate limit: the model server asked to retry',
  provider_limit: 'insufficient_quota: the model account cannot accept this request',
  connection: 'network error: native provider connection failed',
  stream: 'network error: native provider stream failed',
  cancelled: 'Native inference cancelled',
  retired_authority: 'This conversation has retired access. Start a new conversation.',
  stale_authority: 'Conversation access changed. Start a new attempt.',
  foreign_authority: 'Conversation authority is unavailable. Start a new conversation.',
  unknown_source: 'The answer cites an unavailable source. Read the note again.',
  invalid_answer: 'The answer contains unverified citation markup. Start a new attempt.',
  credential: 'The native provider credential is unavailable. Check Settings.',
  closing: 'Chat is closing.',
};
const safeFailures = new Set([...Object.values(nativeFailures), 'Native provider did not return SSE',
  'Native stream ended before headers', 'Citation admission is unavailable']);
function safeFailure(error: unknown, original?: AssistantMessage): string {
  // Pi's public classifiers run before redaction; their canonical categories preserve
  // standard retry/overflow recovery without retaining server echoes or credentials.
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return nativeFailures[error.code] ?? 'The model request could not complete. Start a new attempt.';
  }
  const value = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  // A plan limit is terminal even if it arrives in a 429/streamed error that
  // would otherwise match Pi's generic transient-error classifier.
  if (value.includes('subscription_sharing_usage_limit_exceeded')) return 'insufficient_quota: ChatGPT usage limit reached. Check your ChatGPT plan usage.';
  if (value.includes('subscription_sharing_user_not_eligible')) return 'This ChatGPT account cannot use its subscription here. Check Settings.';
  if (value.includes('insufficient_quota')) return nativeFailures.provider_limit;
  if (/"code"\s*:\s*"credential"/.test(value)) return nativeFailures.credential;
  if (original && isContextOverflow(original)) return nativeFailures.provider_context_overflow;
  if (original && isRetryableAssistantError(original)) return nativeFailures.provider_transient;
  return safeFailures.has(value) ? value : 'The model request could not complete. Start a new attempt.';
}

/** One catalog and parser path for generation and Pi's built-in compaction. No history replacement. */
export function createNativeModels(bindings: ReadonlyMap<string, NativeBinding>, admitMessage: AdmitProviderMessage) {
  const models = createModels();
  const hosted = openaiProvider();
  const refreshes = new Map<string, Promise<void>>();
  const streams = {} as Record<ChatProvider, ProviderStreams>;
  const installProvider = (provider: ChatProvider, catalog: readonly Model<string>[]) => {
    models.setProvider(createProvider({ id: provider, name: provider === 'local' ? 'Local model' : hosted.name,
      auth: { apiKey: { name: 'Native credential', resolve: async () => ({ auth: {} }) } },
      models: catalog, api: streams[provider],
    }));
  };
  const observedAfterInference = new Set<string>();
  const modelKey = (provider: ChatProvider, id: string) => `${provider}:${id}`;
  for (const provider of ['local', 'openai'] as const) {
    const api = provider === 'local' ? 'openai-completions' : 'openai-responses';
    const stream = (simple: boolean, model: Model<string>, transcript: TranscriptContext, options?: SimpleStreamOptions | StreamOptions) => {
      const output = createAssistantMessageEventStream();
      let last: AssistantMessage | undefined;
      let transportFailure: unknown;
      void (async () => {
        await refreshes.get(modelKey(provider, model.id));
        const binding = options?.sessionId ? bindings.get(options.sessionId) : undefined;
        if (!binding) throw new Error('Conversation authority is unavailable');
        await invoke('pi_chat_validate_authority', binding);
        // Native settings select reasoning for every dispatch, including Pi's
        // direct compaction calls. The public map translates a neutral Pi level
        // to the advertised wire value (which may be server-specific). Rust
        // rechecks current settings against untrusted/stale serialized requests.
        const reasoning = model.thinkingLevelMap?.medium ? 'medium' as const : undefined;
        // Represent native API-key auth to Pi without exposing the real key.
        // Its OpenAI provider distinguishes API keys from subscription tokens.
        const authMethod = provider === 'openai' ? await invoke<'apiKey' | 'chatgpt'>('chat_openai_auth_method') : 'apiKey';
        const native = { ...options, reasoning, reasoningEffort: reasoning, apiKey: authMethod === 'chatgpt' ? 'native-subscription-placeholder' : 'sk-native-credential-placeholder', fetch: nativeFetch(binding, provider, model.id, failure => { transportFailure = failure; }), maxTokens: options?.maxTokens ?? Math.min(DEFAULT_GENERATION_MAX_TOKENS, model.maxTokens > 0 ? model.maxTokens : DEFAULT_GENERATION_MAX_TOKENS), transport: 'sse' as const };
        const underlying = provider === 'local'
          ? (simple ? completions.streamSimple : completions.stream)(model as Model<'openai-completions'>, transcript, native)
          : (simple ? hosted.streamSimple : hosted.stream)(model as Model<'openai-responses'>, transcript, native);
        for await (const event of underlying) {
          if ('partial' in event) last = event.partial;
          else if ('message' in event) last = event.message;
          else if ('error' in event) last = event.error;
          if (event.type === 'done') {
            // Keep the protocol's usage, reasoning, tool calls and stop reason.
            // A server may load a local model on first inference. Observe once after
            // text deltas, before terminal completion permits
            // Pi to calculate its next context threshold. Native discovery is bounded
            // to two seconds and failure leaves honest unknown capacity.
            const key = modelKey(provider, model.id);
            if (provider === 'local' && model.contextWindow <= 0 && !observedAfterInference.has(key)) {
              observedAfterInference.add(key);
              const refresh = loadModel(provider, model.id).then(() => {}).catch(() => {});
              refreshes.set(key, refresh);
              await refresh;
              if (refreshes.get(key) === refresh) refreshes.delete(key);
            }
            // Admission follows every asynchronous observation, so authority/source
            // changes during bootstrap cannot slip into terminal Pi history.
            const message = await admitMessage(binding, event.message);
            output.push({ ...event, message });
          } else if (event.type === 'error') {
            output.push({ ...event, error: { ...event.error, errorMessage: safeFailure(transportFailure ?? event.error.errorMessage ?? '', event.error) } });
          } else output.push(event);
        }
      })().catch(error => {
        const errorMessage = safeFailure(transportFailure ?? error);
        const message: AssistantMessage = {
          role: 'assistant', api, provider, model: model.id, timestamp: Date.now(), content: [],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          ...last, stopReason: options?.signal?.aborted ? 'aborted' : 'error', errorMessage
        };
        output.push({ type: 'error', reason: message.stopReason as 'error' | 'aborted', error: message });
      });
      return output;
    };
    streams[provider] = {
      stream: (model, transcript, options) => stream(false, model, transcript, options),
      streamSimple: (model, transcript, options) => stream(true, model, transcript, options),
    };
    installProvider(provider, []);
  }
  const loadModel = async (provider: ChatProvider, id: string) => {
    const configuration = await invoke<NativeModelConfiguration>('pi_chat_model_configuration', { provider, model: id });
    const api = provider === 'local' ? 'openai-completions' : 'openai-responses';
    const published = provider === 'openai' ? hosted.getModels().find(model => model.id === id) : undefined;
    const wireEffort = configuration.reasoningWireEffort ?? null;
    const model: Model<typeof api> = { id, name: id, provider, api, baseUrl: 'https://native.invalid/v1',
      input: configuration.images ? ['text', 'image'] : ['text'], reasoning: wireEffort !== null || configuration.reasoningEffort === 'on',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ...modelLimits(configuration),
      // Pi owns all catalogued capabilities, limits, names and protocol metadata.
      // Clone so refreshing a selected handle cannot mutate its shared catalog.
      ...(published ? structuredClone(published) : {}),
      // Native settings select the effective effort for every dispatch, including
      // compaction. This neutral slot binds that setting, not model capabilities.
      // `on`/unknown omit an override; explicit local off is advertised as `none`.
      thinkingLevelMap: { minimal: null, low: null, high: null, xhigh: null, max: null,
        ...published?.thinkingLevelMap, off: wireEffort === 'none' ? 'none' : null,
        medium: wireEffort === 'none' ? null : wireEffort },
      ...(provider === 'local' ? { compat: { supportsDeveloperRole: false, supportsMidConvoSystemMessages: false,
        supportsReasoningEffort: wireEffort !== null } } : {}) };
    // Native config observes one selected model, not a provider-wide dynamic catalog.
    // Pi 1.3.0's dynamic refresh replaces records; its static factory retains these
    // references. Update a resolved handle only after successful native discovery,
    // before terminal admission allows Pi's next compaction decision to proceed.
    // Read the catalog after the await so concurrent distinct registrations merge.
    const catalog = models.getModels(provider);
    const existing = catalog.find(model => model.id === id);
    if (existing) { Object.assign(existing, model); return existing; }
    installProvider(provider, [...catalog, model]);
    return model;
  };
  const registerModel = async (provider: ChatProvider, id: string) => {
    observedAfterInference.delete(modelKey(provider, id));
    return loadModel(provider, id);
  };
  return Object.assign(models, { registerModel });
}

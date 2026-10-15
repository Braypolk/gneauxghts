import { Channel, invoke } from '@tauri-apps/api/core';
import { createModels, createAssistantMessageEventStream, type AssistantMessage, type Provider, type Model, type SimpleStreamOptions, type StreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import * as responses from '@earendil-works/pi-ai/api/openai-responses';
import * as completions from '@earendil-works/pi-ai/api/openai-completions';
import type { ChatReadSource, VaultAccess } from '$lib/features/chat/types';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';

type NativeFrame = { type: 'headers'; status: number; content_type: string }
  | { type: 'chunk'; bytes: number[] } | { type: 'done' };
export const nativeTransportStats = { chunks:0, bytes:0 };

function nativeFetch(provider: 'local' | 'openai'): typeof fetch {
  return async (_url, options) => {
    if (options?.method !== 'POST' || typeof options.body !== 'string') throw new Error('Only single JSON inference supported');
    const id = crypto.randomUUID();
    const response = Promise.withResolvers<Response>();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let terminal = false;
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { void invoke('pi_cancel_fetch', { id }); }
    });
    const fail = (error: unknown) => {
      if (terminal) return;
      terminal = true; response.reject(error); controller.error(error);
    };
    const frames = new Channel<NativeFrame>();
    frames.onmessage = frame => {
      if (terminal) return;
      if (frame.type === 'headers') response.resolve(new Response(stream, { status: frame.status, headers: { 'content-type': frame.content_type } }));
      if (frame.type === 'chunk') { nativeTransportStats.chunks++; nativeTransportStats.bytes += frame.bytes.length;
        controller.enqueue(Uint8Array.from(frame.bytes)); }
      if (frame.type === 'done') { terminal = true; controller.close(); }
    };
    const abort = () => { void invoke('pi_cancel_fetch', { id }); fail(new DOMException('Aborted', 'AbortError')); };
    if (options.signal?.aborted) { abort(); return response.promise; }
    options.signal?.addEventListener('abort', abort, { once: true });
    void invoke('pi_fetch', { id, provider, body: options.body, frames }).catch(fail)
      .finally(() => options.signal?.removeEventListener('abort', abort));
    return response.promise;
  };
}

export type RequestPolicy = {access:VaultAccess;sources:ChatReadSource[];taskId:number};
export type RequestPolicies = Map<string, RequestPolicy>;

export function nativeModels(policies: RequestPolicies, persist?: (policy:RequestPolicy, answer:{text:string;sources:ChatReadSource[]}) => Promise<void>, modelId = 'pi-native-fixture') {
  const models = createModels();
  for (const provider of ['local', 'openai'] as const) {
    const api = provider === 'openai' ? 'openai-responses' : 'openai-completions';
    const model: Model<typeof api> = {
      ...fauxProvider().getModel(), id: modelId, name: modelId, provider, api,
      baseUrl: 'https://native.invalid/v1', reasoning: false,
      compat: provider === 'local' ? { supportsDeveloperRole: false } : undefined
    };
    const fetch = nativeFetch(provider);
    const stream = (_model: Model<string>, context: TranscriptContext, options?: SimpleStreamOptions | StreamOptions) => {
      const output = createAssistantMessageEventStream();
      const failure = (error:unknown) => {
        const message: AssistantMessage = {...fauxProvider().getModel(), role:'assistant', api, provider, model:modelId,
          content:[], timestamp:Date.now(), usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
          stopReason:options?.signal?.aborted ? 'aborted' : 'error', errorMessage:String(error)};
        output.push({type:'error',reason:message.stopReason as 'aborted'|'error',error:message});
      };
      void (async () => {
        const policy = options?.sessionId ? policies.get(options.sessionId) : undefined;
        if (!policy) throw new Error('Native inference requires explicit Send/Retry and valid current evidence.');
        // Consume once. A reported hook failure cannot reuse a preceding request's policy.
        policies.delete(options!.sessionId!);
        if (policy.sources.length) await invoke('pi_validate_sources',{sources:policy.sources,access:policy.access});
        const lastUser = context.messages.findLastIndex(message => message.role === 'user');
        const filtered = {...context,messages:context.messages.filter((message,index) => index >= lastUser || message.role === 'user' || message.role === 'system')};
        const native = { ...options, fetch, apiKey: 'native-credential-placeholder', maxRetries: 0, transport: 'sse' as const };
        const underlying = provider === 'openai' ? responses.streamSimple(model as Model<'openai-responses'>, filtered, native)
          : completions.streamSimple(model as Model<'openai-completions'>, filtered, native);
        for await (const event of underlying) {
          if (event.type === 'done' && event.message.stopReason !== 'toolUse') {
            const raw = event.message.content.filter(block => block.type === 'text').map(block => block.text).join('');
            const admitted = await invoke<{text:string;sources:ChatReadSource[]}>('pi_admit_answer',{raw,sources:policy.sources,access:policy.access});
            await persist?.(policy,admitted);
            const message = {...event.message,content:[{type:'text' as const,text:admitted.text}]};
            output.push({type:'text_delta',contentIndex:0,delta:admitted.text,partial:message});
            output.push({...event,message});
          } else if (event.type === 'start') {
            output.push({...event,partial:{...event.partial,content:[]}});
          } else if (!event.type.startsWith('text_') && !event.type.startsWith('thinking_')) output.push(event);
        }
      })().catch(failure);
      return output;
    };
    const bridge: Provider = {
      id: provider, name: provider, auth: fauxProvider().provider.auth,
      getModels: () => [model], stream, streamSimple: stream
    };
    models.setProvider(bridge);
  }
  return models;
}

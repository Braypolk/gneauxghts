import catalog from '$lib/contracts/chat-model-catalog.json';
import type {
  ChatProvider,
  ChatReasoningEffort,
  ChatSettings,
  ChatModelCapabilities,
  LocalModel
} from './types';

export interface ChatModelChoice {
  provider: ChatProvider;
  model: string;
  displayName: string;
  description: string;
}

export interface CuratedChatModel {
  id: string;
  label: string;
  description: string;
  reasoningEfforts: ChatReasoningEffort[];
}

export interface ChatReasoningChoice {
  value: ChatReasoningEffort;
  label: string;
}

const STANDARD_REASONING: ChatReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
// JSON is shared with the native catalog. Reject invalid reasoning values at this boundary.
export const OPENAI_CHAT_MODELS: CuratedChatModel[] = catalog.map((model) => ({
  ...model,
  reasoningEfforts: model.reasoningEfforts.map((effort): ChatReasoningEffort => {
    if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max') return effort;
    throw new Error(`Invalid catalog reasoning effort: ${effort}`);
  })
}));

const REASONING_LABELS: Record<ChatReasoningEffort, string> = {
  low: 'Light',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Maximum',
  off: 'Off',
  none: 'Off',
  on: 'On (server default)'
};

export function chatReasoningChoices(
  provider: ChatProvider,
  model: string,
  capabilities?: Pick<ChatModelCapabilities, 'reasoningOptions' | 'defaultReasoningEffort' | 'serverReasoningDefault'> | null
): ChatReasoningChoice[] {
  if (provider === 'local') {
    return (capabilities?.reasoningOptions ?? []).map((value) => ({
      value, label: REASONING_LABELS[value] ?? value
    }));
  }
  const catalogModel = OPENAI_CHAT_MODELS.find((candidate) => candidate.id === model.trim());
  const efforts = catalogModel?.reasoningEfforts ??
    (model.trim().toLowerCase().startsWith('gpt-5') ? STANDARD_REASONING : []);
  return efforts.map((value) => ({ value, label: REASONING_LABELS[value] }));
}

export function normalizeChatReasoningEffort(
  provider: ChatProvider,
  model: string,
  effort: ChatReasoningEffort,
  capabilities?: Pick<ChatModelCapabilities, 'reasoningOptions' | 'defaultReasoningEffort' | 'serverReasoningDefault'> | null
): ChatReasoningEffort {
  const choices = chatReasoningChoices(provider, model, capabilities);
  if (choices.length === 0 || choices.some((choice) => choice.value === effort)) return effort;
  const localDefault = capabilities?.serverReasoningDefault ?? capabilities?.defaultReasoningEffort;
  if (provider === 'local' && choices.some((choice) => choice.value === localDefault)) {
    return localDefault!;
  }
  return choices.some((choice) => choice.value === 'medium') ? 'medium' : choices[0].value;
}

/**
 * Selects a provider's model from settings already resolved by the backend.
 * An empty result means settings have not loaded or that provider has not been
 * configured; the frontend does not invent a model default.
 */
export function configuredChatModel(
  settings: ChatSettings | null,
  provider: ChatProvider
) {
  if (!settings) return '';
  return (
    provider === 'local'
      ? settings.localModel
      : settings.openaiModel
  ).trim();
}

/**
 * Builds a conversation-scoped model menu without inventing provider models.
 * Defaults come from Settings, recent choices come from durable conversations,
 * and local discoveries come from the configured compatible endpoint.
 */
export function chatModelChoices(input: {
  settings: ChatSettings | null;
  current: { provider: ChatProvider; model: string };
  conversations?: Array<{ provider: ChatProvider; model: string }>;
  localModels?: LocalModel[];
  openaiModels?: LocalModel[];
}): ChatModelChoice[] {
  type Candidate = {
    provider: ChatProvider;
    model: string;
    current: boolean;
    default: boolean;
    recent: boolean;
    available: boolean;
  };
  const candidates = new Map<string, Candidate>();
  const add = (
    provider: ChatProvider,
    rawModel: string,
    source?: 'current' | 'default' | 'recent' | 'available'
  ) => {
    const model = rawModel.trim();
    if (!model) return;
    const key = `${provider}:${model}`;
    const candidate = candidates.get(key) ?? {
      provider,
      model,
      current: false,
      default: false,
      recent: false,
      available: false
    };
    if (source) candidate[source] = true;
    candidates.set(key, candidate);
  };

  add(input.current.provider, input.current.model, 'current');
  const availableOpenAi = input.openaiModels
    ? new Set(input.openaiModels.map((model) => model.id))
    : null;
  for (const model of OPENAI_CHAT_MODELS) {
    if (!availableOpenAi || availableOpenAi.has(model.id)) {
      add('openai', model.id, availableOpenAi ? 'available' : undefined);
    }
  }
  add('openai', configuredChatModel(input.settings, 'openai'), 'default');
  add('local', configuredChatModel(input.settings, 'local'), 'default');
  for (const conversation of input.conversations ?? []) {
    add(conversation.provider, conversation.model, 'recent');
  }
  for (const model of input.localModels ?? []) {
    add('local', model.id, 'available');
  }

  return [...candidates.values()].map((candidate) => {
    const catalogModel = OPENAI_CHAT_MODELS.find((model) => model.id === candidate.model);
    const qualifiers = [
      candidate.current ? 'Current' : null,
      candidate.default ? 'Default' : null,
      !candidate.current && !candidate.default && candidate.recent ? 'Recent' : null,
      !candidate.current && !candidate.default && !candidate.recent && candidate.available
        ? 'Available'
        : null
    ].filter((value): value is string => value !== null);
    return {
      provider: candidate.provider,
      model: candidate.model,
      displayName: catalogModel?.label ?? candidate.model,
      description: [catalogModel?.description, ...qualifiers].filter(Boolean).join(' · ')
    };
  });
}

import { describe, expect, it } from 'vitest';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import type { ChatSettings } from './types';
import {
  chatModelChoices,
  chatReasoningChoices,
  configuredChatModel,
  normalizeChatReasoningEffort
} from './chatConfiguration';

const settings: ChatSettings = {
  provider: 'openai',
  model: 'active-model',
  openaiModel: ' hosted-model ',
  localModel: ' local-model ',
  localBaseUrl: 'http://localhost:1234/v1',
  reasoningEffort: 'medium',
  serviceTier: 'standard',
  defaultVaultAccess: 'full',
};

describe('chat configuration', () => {
  it('selects only the backend-resolved model for each provider', () => {
    expect(configuredChatModel(settings, 'openai')).toBe('hosted-model');
    expect(configuredChatModel(settings, 'local')).toBe('local-model');
  });

  it('does not invent a model before settings load', () => {
    expect(configuredChatModel(null, 'openai')).toBe('');
    expect(configuredChatModel(null, 'local')).toBe('');
  });

  it('combines current, default, recent, and discovered models without duplicates', () => {
    const choices = chatModelChoices({
      settings,
      current: { provider: 'openai', model: 'hosted-model' },
      conversations: [
        {
          provider: 'openai', model: 'other-model'
        }
      ],
      localModels: [
        { id: 'local-model', ownedBy: 'lmstudio' },
        { id: 'qwen3-8b', ownedBy: 'lmstudio' }
      ]
    });

    expect(choices.map((choice) => `${choice.provider}:${choice.model}`)).toEqual([
      'openai:hosted-model',
      ...openaiProvider().getModels().map(model => `openai:${model.id}`),
      'local:local-model',
      'openai:other-model',
      'local:qwen3-8b'
    ]);
    expect(choices[0].description).toContain('Current');
    expect(choices[0].description).toContain('Default');
    expect(choices.at(-1)?.description).toContain('Available');
  });

  it('lists Pi model names and retains custom local names', () => {
    const choices = chatModelChoices({ settings: null, current: { provider: 'local', model: 'gpt-6-luna' } });
    expect(choices.find(choice => choice.provider === 'openai' && choice.model === 'gpt-6-luna')?.displayName).toBe('GPT-6 Luna');
    expect(choices.find(choice => choice.model === 'gpt-6.1-sol')?.displayName).toBe('GPT-6.1 Sol');
    expect(choices[0].displayName).toBe('gpt-6-luna');
  });

  it('filters the Pi catalog by account availability without hiding saved or new account models', () => {
    const choices = chatModelChoices({
      settings,
      current: { provider: 'openai', model: 'gpt-5.6-sol' },
      openaiModels: [{ id: 'gpt-6-luna', ownedBy: 'openai' }, { id: 'account-model', ownedBy: 'openai' }]
    });

    expect(choices.filter((choice) => choice.provider === 'openai').map((choice) => choice.model))
      .toEqual(['gpt-5.6-sol', 'gpt-6-luna', 'hosted-model', 'account-model']);
  });

  it('keeps reasoning independent while constraining it to the selected model', () => {
    expect(chatReasoningChoices('openai', 'gpt-5.6-terra').map((choice) => choice.value))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(chatReasoningChoices('openai', 'gpt-5.4').map((choice) => choice.value))
      .toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(chatReasoningChoices('openai', 'gpt-6.1-sol').map((choice) => choice.value))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(chatReasoningChoices('openai', 'gpt-5-mini').map((choice) => choice.value))
      .toEqual(['minimal', 'low', 'medium', 'high']);
    expect(chatReasoningChoices('openai', 'gpt-5.4-pro').map((choice) => choice.value))
      .toEqual(['medium', 'high', 'xhigh']);
    expect(chatReasoningChoices('openai', 'gpt-4.1')).toEqual([]);
    expect(chatReasoningChoices('openai', 'gpt-5-custom')).toEqual([]);
    expect(chatReasoningChoices('local', 'qwen3-8b')).toEqual([]);
    expect(chatReasoningChoices('local', 'qwen/Qwen3.8-27B')).toEqual([]);
    expect(normalizeChatReasoningEffort('openai', 'gpt-5.4', 'max')).toBe('medium');
  });

  it('uses advertised local reasoning choices and replaces an unsupported saved level', () => {
    const capabilities = { reasoningOptions: ['off', 'on'], defaultReasoningEffort: 'on' };
    expect(chatReasoningChoices('local', 'any-model-name', capabilities))
      .toEqual([{ value: 'off', label: 'Off' }, { value: 'on', label: 'On (server default)' }]);
    expect(normalizeChatReasoningEffort('local', 'any-model-name', 'medium', capabilities)).toBe('on');
    expect(normalizeChatReasoningEffort('local', 'any-model-name', 'off', capabilities)).toBe('off');
  });

  it('retains server-provided levels without a model-name or level allowlist', () => {
    const capabilities = { reasoningOptions: ['off', 'brief', 'deep'], defaultReasoningEffort: 'deep' };
    expect(chatReasoningChoices('local', 'custom', capabilities).map((choice) => choice.value))
      .toEqual(['off', 'brief', 'deep']);
    expect(normalizeChatReasoningEffort('local', 'custom', 'medium', capabilities)).toBe('deep');
  });

  it('uses the server fallback for an unsupported conversation value while preserving valid profile choices', () => {
    const capabilities = {
      reasoningOptions: ['off', 'on'],
      defaultReasoningEffort: 'off',
      serverReasoningDefault: 'on'
    };
    expect(normalizeChatReasoningEffort('local', 'custom', 'medium', capabilities)).toBe('on');
    expect(normalizeChatReasoningEffort('local', 'custom', 'off', capabilities)).toBe('off');
  });
});

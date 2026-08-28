import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ModelSelector from './model-selector.svelte';

describe('ModelSelector', () => {
  it('separates the provider picker from its provider-scoped model picker', () => {
    const body = render(ModelSelector, {
      props: {
        options: [
          {
            provider: 'openai',
            model: 'hosted-default',
            displayName: 'Hosted Default',
            description: 'Current · Default'
          },
          {
            provider: 'local',
            model: 'qwen3-8b',
            displayName: 'qwen3-8b',
            description: 'Available'
          }
        ],
        provider: 'openai',
        model: 'hosted-default',
        reasoningEffort: 'medium',
        reasoningOptions: [{ value: 'medium', label: 'Medium' }],
        providerOpen: true,
        modelOpen: true,
        reasoningOpen: true,
        onProviderOpenChange: () => undefined,
        onModelOpenChange: () => undefined,
        onReasoningOpenChange: () => undefined,
        onSelectProvider: () => undefined,
        onSelectModel: () => undefined,
        onSelectReasoning: () => undefined,
        onDiscoverLocal: () => undefined
      }
    }).body;

    expect(body).toContain('AI provider picker');
    expect(body).toContain('ChatGPT');
    expect(body).toContain('Local');
    expect(body).not.toContain('qwen3-8b');
    expect(body).not.toContain('Discover local models');
    expect(body).toContain('aria-label="Custom model ID"');
    expect(body).toContain('Hosted Default');
    expect(body).toContain('Reasoning effort picker');
    expect(body).toContain('Use a ChatGPT model ID');
  });

  it('offers discovery only in the local model picker', () => {
    const body = render(ModelSelector, {
      props: {
        options: [{
          provider: 'local', model: 'qwen3-8b', displayName: 'qwen3-8b',
          description: 'Available'
        }],
        provider: 'local',
        model: 'qwen3-8b',
        reasoningEffort: 'medium',
        reasoningOptions: [],
        providerOpen: false,
        modelOpen: true,
        reasoningOpen: false,
        onProviderOpenChange: () => undefined,
        onModelOpenChange: () => undefined,
        onReasoningOpenChange: () => undefined,
        onSelectProvider: () => undefined,
        onSelectModel: () => undefined,
        onSelectReasoning: () => undefined,
        onDiscoverLocal: () => undefined
      }
    }).body;

    expect(body).toContain('qwen3-8b');
    expect(body).toContain('Discover local models');
    expect(body).toContain('Use a Local model ID');
  });
});

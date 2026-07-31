import { describe, expect, it } from 'vitest';
import type { ChatSettings } from './types';
import { configuredChatModel } from './chatConfiguration';

const settings: ChatSettings = {
  provider: 'openai',
  model: 'active-model',
  openaiModel: ' hosted-model ',
  localModel: ' local-model ',
  localBaseUrl: 'http://localhost:1234/v1',
  serviceTier: 'standard',
  webAccess: 'auto',
  defaultVaultAccess: 'full',
  atlasVisibility: 'hidden'
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
});

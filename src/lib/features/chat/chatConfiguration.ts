import type { ChatProvider, ChatSettings } from './types';

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

import { expect, it, vi } from 'vitest';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./nativeInvoke', () => native);
import { chatSettings } from './settings';

it('supplies the installed Pi catalog when querying native account availability', async () => {
  const available = [{ id: 'gpt-6-luna', ownedBy: 'openai' }];
  native.invoke.mockResolvedValue(available);
  expect(await chatSettings.listOpenAiModels()).toEqual(available);
  expect(native.invoke).toHaveBeenCalledWith('chat_list_openai_models', {
    modelIds: openaiProvider().getModels().map(model => model.id)
  });
});

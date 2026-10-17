<script lang="ts">
  import { chatSettings } from '../pi/settings';
  import { chatModelChoices, chatReasoningChoices, normalizeChatReasoningEffort, type ChatModelChoice } from '../chatConfiguration';
  import type { ChatModelCapabilities, ChatProvider, ChatSettings, LocalModel } from '../types';
  import type { PiConversationBinding } from './piConversationView';
  import ChatModelSelector from './ChatModelSelector.svelte';

  let { binding, disabled = false, modelOpen, reasoningOpen, onModelOpenChange, onReasoningOpenChange }: {
    binding: PiConversationBinding; disabled?: boolean; modelOpen: boolean; reasoningOpen: boolean;
    onModelOpenChange: (open: boolean) => void; onReasoningOpenChange: (open: boolean) => void;
  } = $props();
  const snapshot = $derived($binding);
  let settings = $state<ChatSettings | null>(null), capabilities = $state<ChatModelCapabilities | null>(null);
  let localModels = $state<LocalModel[]>([]), openaiModels = $state<LocalModel[] | undefined>();
  let discoveringLocal = $state(false), discoveringOpenAi = $state(false), saving = $state(false);
  let refresh = $state(0);
  const capabilityKey = $derived(JSON.stringify([snapshot.provider, snapshot.model, refresh]));
  $effect(() => {
    // Stream commits replace the view snapshot. Discover only when model identity changes.
    const [provider, model] = JSON.parse(capabilityKey) as [ChatProvider, string, number];
    let current = true;
    capabilities = null;
    void Promise.all([chatSettings.getSettings(), model ? chatSettings.getModelCapabilities(provider, model) : Promise.resolve(null)])
      .then(([value, modelCapabilities]) => { if (current) { settings = value; capabilities = modelCapabilities; } })
      .catch(error => { if (current) binding.report(error); });
    return () => { current = false; };
  });
  const choices = $derived(chatModelChoices({ settings, current: { provider: snapshot.provider, model: snapshot.model },
    conversations: snapshot.conversations.flatMap(row => row.model && (row.model.provider === 'local' || row.model.provider === 'openai') ? [{ provider: row.model.provider, model: row.model.modelId }] : []),
    localModels, openaiModels }));
  const reasoningOptions = $derived(chatReasoningChoices(snapshot.provider, snapshot.model, capabilities));
  const reasoningEffort = $derived(normalizeChatReasoningEffort(snapshot.provider, snapshot.model,
    snapshot.provider === 'local' ? capabilities?.defaultReasoningEffort ?? 'off' : settings?.reasoningEffort ?? '', capabilities));
  async function selectModel(option: ChatModelChoice) {
    if (disabled || saving) return;
    saving = true;
    try { await binding.configure(option.provider, option.model); onModelOpenChange(false); }
    catch (error) { binding.report(error); } finally { saving = false; }
  }
  async function selectReasoning(effort: string) {
    if (disabled || saving) return;
    saving = true;
    const provider = snapshot.provider, model = snapshot.model;
    try {
      if (provider === 'local') {
        const current = await chatSettings.getModelCapabilities(provider, model);
        await chatSettings.setLocalModelCapabilities(model, { images: current.images, tools: current.tools, audio: current.audio, video: current.video, reasoningEffort: effort });
      } else {
        const defaults = await chatSettings.getSettings();
        await chatSettings.setDefaults({ ...defaults, reasoningEffort: effort });
      }
      // Refresh native Pi model options after the native settings owner accepts the change.
      if (snapshot.provider === provider && snapshot.model === model) await binding.configure(provider, model);
      refresh++;
      onReasoningOpenChange(false);
    } catch (error) { binding.report(error); } finally { saving = false; }
  }
  async function discover(provider: 'local' | 'openai') {
    if (provider === 'local') discoveringLocal = true; else discoveringOpenAi = true;
    try {
      if (provider === 'local') localModels = await chatSettings.listLocalModels((await chatSettings.getSettings()).localBaseUrl);
      else openaiModels = await chatSettings.listOpenAiModels();
    } catch (error) { binding.report(error); }
    finally { if (provider === 'local') discoveringLocal = false; else discoveringOpenAi = false; }
  }
</script>

<ChatModelSelector options={choices} provider={snapshot.provider} model={snapshot.model} {reasoningEffort} {reasoningOptions}
  disabled={disabled || saving} {modelOpen} {reasoningOpen} {onModelOpenChange} {onReasoningOpenChange}
  onSelectModel={selectModel} onSelectReasoning={selectReasoning} isDiscoveringLocal={discoveringLocal} isDiscoveringOpenAi={discoveringOpenAi}
  onDiscoverLocal={() => discover('local')} onDiscoverOpenAi={() => discover('openai')} />

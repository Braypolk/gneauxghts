import { invoke } from '@tauri-apps/api/core';
import { get, writable } from 'svelte/store';
import {
  defaultRememberActionPreference,
  rememberActions,
  setDefaultRememberActionPreference,
  setRememberActions
} from '$lib/appSettings';
import type {
  AiDiagnosticsSnapshot,
  AiModelOption,
  AiProviderKind,
  AiSettings,
  AiSettingsUpdate,
  CustomRememberActionKind,
  EditableRememberAction,
  EditableRememberActionFamily
} from '$lib/types/ai';

export type AiSubTab = 'connection' | 'remember' | 'usage';

export interface AiRememberSettingsState {
  aiSubTab: AiSubTab;
  aiSettings: AiSettings | null;
  aiProviderKindInput: AiProviderKind;
  aiBaseUrlInput: string;
  aiModelInput: string;
  aiApiKeyInput: string;
  aiModels: AiModelOption[];
  aiModelsError: string;
  isLoadingAiModels: boolean;
  isSavingAiSettings: boolean;
  rememberActionDrafts: EditableRememberAction[];
  canSaveRememberActions: boolean;
  isSavingRememberActions: boolean;
  aiDiagnostics: AiDiagnosticsSnapshot | null;
  isLoadingAiDiagnostics: boolean;
  isClearingAiDiagnostics: boolean;
  expandedActionId: string | null;
}

function canSaveRememberActions(drafts: EditableRememberAction[]) {
  return drafts.every(
    (action) =>
      action.label.trim() !== '' &&
      action.prompt.trim() !== '' &&
      (action.kind === 'singleNote' ||
        action.family === 'organize' ||
        action.family === 'integrate')
  );
}

function createInitialState(): AiRememberSettingsState {
  return {
    aiSubTab: 'connection',
    aiSettings: null,
    aiProviderKindInput: 'openAiCompatible',
    aiBaseUrlInput: '',
    aiModelInput: '',
    aiApiKeyInput: '',
    aiModels: [],
    aiModelsError: '',
    isLoadingAiModels: false,
    isSavingAiSettings: false,
    rememberActionDrafts: [],
    canSaveRememberActions: true,
    isSavingRememberActions: false,
    aiDiagnostics: null,
    isLoadingAiDiagnostics: true,
    isClearingAiDiagnostics: false,
    expandedActionId: null
  };
}

function defaultFamilyForKind(kind: CustomRememberActionKind): EditableRememberActionFamily {
  return kind === 'singleNote' ? 'edit' : 'organize';
}

function createBlankRememberAction(kind: CustomRememberActionKind): EditableRememberAction {
  return {
    id: `custom-${crypto.randomUUID()}`,
    label: '',
    description: '',
    prompt: '',
    kind,
    family: defaultFamilyForKind(kind),
    visible: true
  };
}

export function createAiRememberSettingsStore() {
  const store = writable<AiRememberSettingsState>(createInitialState());
  const { subscribe, update } = store;
  let activeModelRequest = 0;

  function patch(partial: Partial<AiRememberSettingsState>) {
    update((state) => ({
      ...state,
      ...partial,
      canSaveRememberActions: canSaveRememberActions(
        partial.rememberActionDrafts ?? state.rememberActionDrafts
      )
    }));
  }

  function setAiSubTab(aiSubTab: AiSubTab) {
    patch({ aiSubTab });
  }

  function setAiProviderKindInput(aiProviderKindInput: AiProviderKind) {
    patch({ aiProviderKindInput });
  }

  function setAiBaseUrlInput(aiBaseUrlInput: string) {
    patch({ aiBaseUrlInput });
  }

  function setAiModelInput(aiModelInput: string) {
    patch({ aiModelInput });
  }

  function setAiApiKeyInput(aiApiKeyInput: string) {
    patch({ aiApiKeyInput });
  }

  function toggleExpandAction(id: string) {
    patch({ expandedActionId: get(store).expandedActionId === id ? null : id });
  }

  async function loadAiSettings() {
    try {
      const settings = await invoke<AiSettings>('get_ai_settings');
      patch({
        aiSettings: settings,
        aiProviderKindInput: settings.providerKind,
        aiBaseUrlInput: settings.baseUrl,
        aiModelInput: settings.model,
        rememberActionDrafts: get(rememberActions).map((action) => ({ ...action })),
        aiModels: settings.model.trim() !== '' ? [{ id: settings.model }] : [],
        aiModelsError: ''
      });
      void loadAiDiagnostics();
      if (settings.providerKind === 'openAiCompatible' && settings.apiKeyConfigured) {
        window.setTimeout(() => {
          void loadAiModels();
        }, 0);
      }
    } catch (error) {
      console.error('Failed to load AI settings:', error);
    }
  }

  async function loadAiDiagnostics() {
    patch({ isLoadingAiDiagnostics: true });
    try {
      patch({ aiDiagnostics: await invoke<AiDiagnosticsSnapshot>('get_ai_diagnostics') });
    } catch (error) {
      console.error('Failed to load AI diagnostics:', error);
    } finally {
      patch({ isLoadingAiDiagnostics: false });
    }
  }

  async function loadAiModels() {
    const state = get(store);
    const requestId = ++activeModelRequest;

    if (state.aiProviderKindInput !== 'openAiCompatible') {
      patch({
        aiModels: [],
        aiModelsError: '',
        isLoadingAiModels: false
      });
      return;
    }

    patch({ isLoadingAiModels: true });
    try {
      const models = await invoke<AiModelOption[]>('list_ai_models', {
        baseUrl: state.aiBaseUrlInput,
        apiKey: state.aiApiKeyInput.trim() === '' ? null : state.aiApiKeyInput
      });
      if (requestId !== activeModelRequest) {
        return;
      }

      patch({
        aiModels:
          state.aiModelInput.trim() !== '' && !models.some((model) => model.id === state.aiModelInput)
            ? [{ id: state.aiModelInput }, ...models]
            : models,
        aiModelsError: ''
      });
    } catch (error) {
      if (requestId !== activeModelRequest) {
        return;
      }

      console.error('Failed to load AI models:', error);
      patch({
        aiModelsError: 'Unable to load models from /v1/models.',
        aiModels: state.aiModelInput.trim() !== '' ? [{ id: state.aiModelInput }] : []
      });
    } finally {
      if (requestId === activeModelRequest) {
        patch({ isLoadingAiModels: false });
      }
    }
  }

  async function saveAiSettings() {
    const state = get(store);
    const nextSettings: AiSettingsUpdate = {
      providerKind: state.aiProviderKindInput,
      baseUrl: state.aiBaseUrlInput,
      model: state.aiModelInput,
      apiKey: state.aiApiKeyInput.trim() === '' ? null : state.aiApiKeyInput
    };

    patch({ isSavingAiSettings: true });
    try {
      const aiSettings = await invoke<AiSettings>('set_ai_settings', { settings: nextSettings });
      patch({
        aiSettings,
        aiProviderKindInput: aiSettings.providerKind,
        aiBaseUrlInput: aiSettings.baseUrl,
        aiModelInput: aiSettings.model,
        aiApiKeyInput: ''
      });
      await loadAiModels();
    } catch (error) {
      console.error('Failed to save AI settings:', error);
    } finally {
      patch({ isSavingAiSettings: false });
    }
  }

  async function clearAiDiagnostics() {
    patch({ isClearingAiDiagnostics: true });
    try {
      await invoke('clear_ai_diagnostics');
      await loadAiDiagnostics();
    } catch (error) {
      console.error('Failed to clear AI diagnostics:', error);
    } finally {
      patch({ isClearingAiDiagnostics: false });
    }
  }

  function addRememberAction(kind: CustomRememberActionKind) {
    const next = createBlankRememberAction(kind);
    patch({
      rememberActionDrafts: [...get(store).rememberActionDrafts, next],
      expandedActionId: next.id
    });
  }

  function updateRememberAction(
    id: string,
    field: keyof Pick<
      EditableRememberAction,
      'label' | 'description' | 'prompt' | 'kind' | 'family' | 'visible'
    >,
    value: string | boolean
  ) {
    patch({
      rememberActionDrafts: get(store).rememberActionDrafts.map((action) => {
        if (action.id !== id) {
          return action;
        }

        const nextAction = { ...action, [field]: value } as EditableRememberAction;
        if (field === 'kind') {
          nextAction.family =
            value === 'singleNote'
              ? 'edit'
              : nextAction.family === 'edit'
                ? 'organize'
                : nextAction.family;
        }
        if (nextAction.kind === 'singleNote') {
          nextAction.family = 'edit';
        }
        return nextAction;
      })
    });
  }

  function removeRememberAction(id: string) {
    if (get(defaultRememberActionPreference) === id) {
      setDefaultRememberActionPreference('exact');
    }

    patch({
      rememberActionDrafts: get(store).rememberActionDrafts.filter((action) => action.id !== id),
      expandedActionId: get(store).expandedActionId === id ? null : get(store).expandedActionId
    });
  }

  async function saveRememberActions() {
    const state = get(store);
    if (!state.canSaveRememberActions) {
      return;
    }

    patch({ isSavingRememberActions: true });
    try {
      const sanitized = state.rememberActionDrafts.map((action) => ({
        ...action,
        label: action.label.trim(),
        description: action.description.trim(),
        prompt: action.prompt.trim(),
        family: action.kind === 'singleNote' ? 'edit' : action.family
      }));
      setRememberActions(sanitized);
      patch({
        rememberActionDrafts: sanitized.map((action) => ({ ...action }))
      });
      if (
        get(defaultRememberActionPreference) !== 'exact' &&
        !sanitized.some(
          (action) => action.id === get(defaultRememberActionPreference) && action.visible
        )
      ) {
        setDefaultRememberActionPreference('exact');
      }
    } finally {
      patch({ isSavingRememberActions: false });
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void loadAiSettings();
    }
  }

  function initialize() {
    void loadAiSettings();
  }

  return {
    subscribe,
    setAiSubTab,
    setAiProviderKindInput,
    setAiBaseUrlInput,
    setAiModelInput,
    setAiApiKeyInput,
    loadAiSettings,
    loadAiDiagnostics,
    loadAiModels,
    saveAiSettings,
    clearAiDiagnostics,
    addRememberAction,
    updateRememberAction,
    removeRememberAction,
    saveRememberActions,
    toggleExpandAction,
    initialize,
    handleVisibilityChange
  };
}

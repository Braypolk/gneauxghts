import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { get, writable } from "svelte/store";
import type { ForgottenNoteSummary } from "$lib/types/forgottenNotes";
import type { VaultInfo } from "$lib/types/vault";
import type {
  SemanticDebugSnapshot,
  SemanticModelDownloadResult,
  SemanticSettings,
  SemanticStatus,
} from "$lib/types/semantic";
import {
  refreshSettingsAfterVaultChange,
  refreshSettingsForVisibility,
} from "./refreshCoordinator";
import { loadForgottenNotesSlice } from "./loaders/forgottenLoader";
import {
  loadSemanticSlice,
  loadSemanticStatusSlice,
} from "./loaders/semanticLoader";
import { loadSettingsViewSlice } from "./loaders/settingsViewLoader";
import { loadVaultInfoSlice } from "./loaders/vaultLoader";

type SettingsTab = "general" | "forgotten";
type GeneralSection =
  | "appearance"
  | "shortcuts"
  | "forgetting"
  | "ai"
  | "vault"
  | "search";
type ForgottenAction = "restore_forgotten_notes" | "delete_forgotten_notes";
type SemanticAction =
  | "rebuild_semantic_index"
  | "pause_semantic_indexing"
  | "resume_semantic_indexing"
  | "prepare_semantic_model";

interface SettingsState {
  semanticStatus: SemanticStatus | null;
  semanticSettings: SemanticSettings | null;
  semanticDebug: SemanticDebugSnapshot | null;
  vaultInfo: VaultInfo | null;
  vaultPathInput: string;
  activeVaultPath: string;
  vaultSaveError: string | null;
  isSavingVault: boolean;
  isPickingVault: boolean;
  isRestarting: boolean;
  activeTab: SettingsTab;
  activeGeneralSection: GeneralSection;
  forgottenNotes: ForgottenNoteSummary[];
  selectedForgottenPaths: string[];
  isLoadingForgottenNotes: boolean;
  isUpdatingForgottenNotes: boolean;
  isSaving: boolean;
  isRunningAction: boolean;
  semanticLayerError: string | null;
  semanticLayerMessage: string | null;
}

function createInitialState(): SettingsState {
  return {
    semanticStatus: null,
    semanticSettings: null,
    semanticDebug: null,
    vaultInfo: null,
    vaultPathInput: "",
    activeVaultPath: "",
    vaultSaveError: null,
    isSavingVault: false,
    isPickingVault: false,
    isRestarting: false,
    activeTab: "general",
    activeGeneralSection: "appearance",
    forgottenNotes: [],
    selectedForgottenPaths: [],
    isLoadingForgottenNotes: false,
    isUpdatingForgottenNotes: false,
    isSaving: false,
    isRunningAction: false,
    semanticLayerError: null,
    semanticLayerMessage: null,
  };
}

export function createSettingsStore() {
  const store = writable<SettingsState>(createInitialState());
  const { subscribe, update } = store;

  let semanticPollTimer: ReturnType<typeof window.setInterval> | null = null;
  let vaultChangeRefreshTimer: ReturnType<typeof window.setTimeout> | null =
    null;
  let semanticStatusRequest: Promise<void> | null = null;
  let semanticStateRequest: Promise<void> | null = null;
  let forgottenNotesRequest: Promise<void> | null = null;
  let vaultNoteChangeUnlisten: UnlistenFn | null = null;
  let semanticStatusUnlisten: UnlistenFn | null = null;

  function patch(partial: Partial<SettingsState>) {
    update((state) => ({ ...state, ...partial }));
  }

  function setActiveTab(activeTab: SettingsTab) {
    patch({ activeTab });
  }

  function setActiveGeneralSection(activeGeneralSection: GeneralSection) {
    patch({ activeGeneralSection });
  }

  function applyVaultInfo(nextVaultInfo: VaultInfo, resetInput = false) {
    update((state) => ({
      ...state,
      vaultInfo: nextVaultInfo,
      vaultPathInput: resetInput
        ? nextVaultInfo.currentPath
        : state.vaultPathInput.trim() === ""
          ? nextVaultInfo.currentPath
          : state.vaultPathInput,
      activeVaultPath:
        state.activeVaultPath === ""
          ? nextVaultInfo.currentPath
          : state.activeVaultPath,
      vaultSaveError: null,
    }));
  }

  async function pickVaultDirectory() {
    const state = get(store);
    if (!(state.vaultInfo?.canConfigurePath ?? true)) {
      return;
    }

    patch({ isPickingVault: true, vaultSaveError: null });
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath:
          state.vaultPathInput.trim() || state.vaultInfo?.currentPath || undefined,
        title: "Choose vault folder",
      });
      if (typeof selected === "string" && selected.trim() !== "") {
        patch({ vaultPathInput: selected });
      }
    } catch (error) {
      console.error("Failed to pick vault directory:", error);
      patch({ vaultSaveError: String(error) });
    } finally {
      patch({ isPickingVault: false });
    }
  }

  async function restartApp() {
    patch({ isRestarting: true });
    try {
      await relaunch();
    } catch (error) {
      console.error("Failed to restart app:", error);
      patch({ vaultSaveError: String(error), isRestarting: false });
    }
  }

  function setVaultPathInput(vaultPathInput: string) {
    patch({ vaultPathInput, vaultSaveError: null });
  }

  function setSelectedForgottenPaths(
    selectedForgottenPaths: string[] | ((current: string[]) => string[]),
  ) {
    update((state) => ({
      ...state,
      selectedForgottenPaths:
        typeof selectedForgottenPaths === "function"
          ? selectedForgottenPaths(state.selectedForgottenPaths)
          : selectedForgottenPaths,
    }));
  }

  function stopSemanticPolling() {
    if (semanticPollTimer) {
      window.clearInterval(semanticPollTimer);
      semanticPollTimer = null;
    }
  }

  function shouldPollSemanticState() {
    const state = get(store);
    return Boolean(
      state.semanticStatus?.indexingInProgress ||
        state.isRunningAction ||
        state.isSaving,
    );
  }

  function syncSemanticPolling() {
    if (
      typeof document === "undefined" ||
      document.visibilityState !== "visible"
    ) {
      stopSemanticPolling();
      return;
    }

    if (!shouldPollSemanticState()) {
      stopSemanticPolling();
      return;
    }

    if (semanticPollTimer) {
      return;
    }

    semanticPollTimer = window.setInterval(() => {
      void loadSemanticStatus();
    }, 5000);
  }

  async function loadVaultInfo() {
    try {
      applyVaultInfo(await loadVaultInfoSlice());
    } catch (error) {
      console.error("Failed to load vault info:", error);
    }
  }

  async function loadSemanticStatus() {
    if (semanticStatusRequest) {
      return semanticStatusRequest;
    }

    semanticStatusRequest = (async () => {
      try {
        patch({ semanticStatus: await loadSemanticStatusSlice() });
        syncSemanticPolling();
      } catch (error) {
        console.error("Failed to load semantic status:", error);
      } finally {
        semanticStatusRequest = null;
      }
    })();

    return semanticStatusRequest;
  }

  async function loadSemanticState() {
    if (semanticStateRequest) {
      return semanticStateRequest;
    }

    semanticStateRequest = (async () => {
      try {
        // Prefer the bundled get_settings_view command which collapses
        // the four parallel invokes into one. Fall back to the legacy
        // parallel fan-out if the bundled command errors so the
        // settings panel keeps working.
        try {
          const view = await loadSettingsViewSlice();
          update((state) => ({
            ...state,
            semanticStatus: view.semanticStatus,
            semanticSettings: view.semanticSettings,
            semanticDebug: view.semanticDebug,
          }));
          applyVaultInfo(view.vault);
        } catch (bundledError) {
          console.warn(
            "get_settings_view failed, falling back to individual loads:",
            bundledError,
          );
          const [semantic, nextVaultInfo] = await Promise.all([
            loadSemanticSlice(),
            loadVaultInfoSlice(),
          ]);
          update((state) => ({
            ...state,
            semanticStatus: semantic.status,
            semanticSettings: semantic.settings,
            semanticDebug: semantic.debug,
          }));
          applyVaultInfo(nextVaultInfo);
        }
        syncSemanticPolling();
      } catch (error) {
        console.error("Failed to load semantic settings:", error);
      } finally {
        semanticStateRequest = null;
      }
    })();

    return semanticStateRequest;
  }

  async function loadForgottenNotes() {
    if (forgottenNotesRequest) {
      return forgottenNotesRequest;
    }

    patch({ isLoadingForgottenNotes: true });

    forgottenNotesRequest = (async () => {
      try {
        const forgottenNotes = await loadForgottenNotesSlice();
        update((state) => ({
          ...state,
          forgottenNotes,
          selectedForgottenPaths: state.selectedForgottenPaths.filter((path) =>
            forgottenNotes.some((note) => note.forgottenPath === path),
          ),
        }));
      } catch (error) {
        console.error("Failed to load forgotten notes:", error);
      } finally {
        forgottenNotesRequest = null;
        patch({ isLoadingForgottenNotes: false });
      }
    })();

    return forgottenNotesRequest;
  }

  async function runForgottenAction(
    command: ForgottenAction,
    forgottenPaths: string[],
  ) {
    if (forgottenPaths.length === 0) return;

    patch({ isUpdatingForgottenNotes: true });
    try {
      await invoke(command, { forgottenPaths });
      setSelectedForgottenPaths((current) =>
        current.filter((path) => !forgottenPaths.includes(path)),
      );
      await loadForgottenNotes();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
    } finally {
      patch({ isUpdatingForgottenNotes: false });
    }
  }

  function toggleForgottenSelection(forgottenPath: string, checked: boolean) {
    setSelectedForgottenPaths((current) =>
      checked
        ? Array.from(new Set([...current, forgottenPath]))
        : current.filter((path) => path !== forgottenPath),
    );
  }

  function toggleAllForgottenSelections(checked: boolean) {
    const state = get(store);
    setSelectedForgottenPaths(
      checked ? state.forgottenNotes.map((note) => note.forgottenPath) : [],
    );
  }

  async function saveSettings() {
    const state = get(store);
    if (!state.semanticSettings) return;

    patch({ isSaving: true });
    try {
      patch({
        semanticSettings: await invoke<SemanticSettings>(
          "set_semantic_settings",
          {
            settings: state.semanticSettings,
          },
        ),
      });
      await loadSemanticState();
    } catch (error) {
      console.error("Failed to save semantic settings:", error);
    } finally {
      patch({ isSaving: false });
    }
  }

  function updateSetting<Key extends keyof SemanticSettings>(
    key: Key,
    value: SemanticSettings[Key],
  ) {
    update((state) => {
      if (!state.semanticSettings) {
        return state;
      }

      return {
        ...state,
        semanticSettings: {
          ...state.semanticSettings,
          [key]: value,
        },
      };
    });
    void saveSettings();
  }

  async function runAction(command: SemanticAction) {
    patch({
      isRunningAction: true,
      semanticLayerError: null,
      semanticLayerMessage: null,
    });
    try {
      await invoke(command);
      await loadSemanticState();
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
      patch({ semanticLayerError: String(error), semanticLayerMessage: null });
    } finally {
      patch({ isRunningAction: false });
    }
  }

  async function downloadEmbeddingModel() {
    patch({
      isRunningAction: true,
      semanticLayerError: null,
      semanticLayerMessage: null,
    });
    try {
      const result = await invoke<SemanticModelDownloadResult>(
        "download_semantic_embedding_model",
      );
      patch({
        semanticLayerMessage: result.alreadyPresent
          ? "Embedding model is already installed."
          : "Embedding model downloaded successfully.",
        semanticLayerError: null,
      });
      await loadSemanticState();
    } catch (error) {
      console.error("Failed to download embedding model:", error);
      patch({ semanticLayerError: String(error), semanticLayerMessage: null });
    } finally {
      patch({ isRunningAction: false });
    }
  }

  async function clearDebugMetrics() {
    try {
      await invoke("clear_semantic_debug_metrics");
      await loadSemanticState();
    } catch (error) {
      console.error("Failed to clear semantic debug metrics:", error);
    }
  }

  async function saveVaultDirectory() {
    patch({ isSavingVault: true, vaultSaveError: null });
    try {
      const state = get(store);
      const nextVaultInfo = await invoke<VaultInfo>("set_vault_directory", {
        path:
          state.vaultPathInput.trim() === ""
            ? null
            : state.vaultPathInput.trim(),
      });
      applyVaultInfo(nextVaultInfo, true);
    } catch (error) {
      console.error("Failed to save vault directory:", error);
      patch({ vaultSaveError: String(error) });
    } finally {
      patch({ isSavingVault: false });
    }
  }

  async function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      await refreshSettingsForVisibility(get(store).activeGeneralSection, {
        loadSemanticState,
        loadSemanticStatus,
        loadVaultInfo,
        loadForgottenNotes,
      });
      syncSemanticPolling();
      return;
    }

    stopSemanticPolling();
  }

  function scheduleVaultChangeRefresh(delayMs = 350) {
    if (vaultChangeRefreshTimer) {
      window.clearTimeout(vaultChangeRefreshTimer);
    }

    vaultChangeRefreshTimer = window.setTimeout(() => {
      vaultChangeRefreshTimer = null;
      void refreshSettingsAfterVaultChange({
        loadSemanticStatus,
        loadVaultInfo,
        loadForgottenNotes,
      });
    }, delayMs);
  }

  async function initialize() {
    await Promise.all([loadSemanticState(), loadForgottenNotes()]);
    vaultNoteChangeUnlisten = await listen("vault-note-changed", () => {
      scheduleVaultChangeRefresh();
    });
    // Backend pushes `semantic-status-changed` after mutations (settings
    // save, rebuild/pause/resume, vault change). Reduce to listening
    // instead of polling those code paths; we still poll while indexing
    // is in progress because background workers don't currently emit.
    semanticStatusUnlisten = await listen<SemanticStatus>(
      "semantic-status-changed",
      ({ payload }) => {
        patch({ semanticStatus: payload });
        syncSemanticPolling();
      },
    );
  }

  function dispose() {
    stopSemanticPolling();
    if (vaultChangeRefreshTimer) {
      window.clearTimeout(vaultChangeRefreshTimer);
      vaultChangeRefreshTimer = null;
    }
    vaultNoteChangeUnlisten?.();
    vaultNoteChangeUnlisten = null;
    semanticStatusUnlisten?.();
    semanticStatusUnlisten = null;
  }

  return {
    subscribe,
    initialize,
    dispose,
    handleVisibilityChange,
    setActiveTab,
    setActiveGeneralSection,
    setVaultPathInput,
    pickVaultDirectory,
    restartApp,
    loadForgottenNotes,
    runForgottenAction,
    toggleForgottenSelection,
    toggleAllForgottenSelections,
    loadSemanticStatus,
    loadSemanticState,
    updateSetting,
    runAction,
    downloadEmbeddingModel,
    clearDebugMetrics,
    saveVaultDirectory,
  };
}

export type { GeneralSection, SettingsState, SettingsTab };

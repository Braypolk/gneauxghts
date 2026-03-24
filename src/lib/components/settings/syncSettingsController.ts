import { invoke } from '@tauri-apps/api/core';
import type {
  RequestMagicLinkResponse,
  SyncConflict,
  SyncConflictDetail,
  SyncStatus,
  VaultInfo
} from '$lib/types/sync';

type ConflictDiffRow = {
  lineNumber: number;
  localLine: string;
  remoteLine: string;
  kind: 'same' | 'changed' | 'local-only' | 'remote-only';
};

interface SyncSettingsControllerDeps {
  getVaultPathInput: () => string;
  setVaultInfo: (value: VaultInfo | null) => void;
  setSyncStatus: (value: SyncStatus | null) => void;
  getSyncStatus: () => SyncStatus | null;
  getSyncBaseUrlInput: () => string;
  getSyncEmailInput: () => string;
  getMagicLinkTokenInput: () => string;
  setMagicLinkTokenInput: (value: string) => void;
  setLastMagicLinkResponse: (value: RequestMagicLinkResponse | null) => void;
  setSyncConflicts: (value: SyncConflict[]) => void;
  getActiveConflictNoteId: () => string | null;
  setActiveConflictNoteId: (value: string | null) => void;
  getActiveConflictDetail: () => SyncConflictDetail | null;
  setActiveConflictDetail: (value: SyncConflictDetail | null) => void;
  getDismissingConflictNoteIds: () => string[];
  setDismissingConflictNoteIds: (value: string[]) => void;
  getResolvingConflictNoteIds: () => string[];
  setResolvingConflictNoteIds: (value: string[]) => void;
  setSyncUiError: (value: string | null) => void;
  setSyncUiMessage: (value: string | null) => void;
  setIsSavingVault: (value: boolean) => void;
  setIsRequestingMagicLink: (value: boolean) => void;
  setIsCompletingSyncSignIn: (value: boolean) => void;
  setIsSyncingNow: (value: boolean) => void;
  setIsTogglingSyncPause: (value: boolean) => void;
  setIsSigningOutSync: (value: boolean) => void;
  setIsLoadingConflictDetail: (value: boolean) => void;
  loadSemanticState: () => Promise<void>;
  loadForgottenNotes: () => Promise<void>;
}

export function createSyncSettingsController({
  getVaultPathInput,
  setVaultInfo,
  setSyncStatus,
  getSyncStatus,
  getSyncBaseUrlInput,
  getSyncEmailInput,
  getMagicLinkTokenInput,
  setMagicLinkTokenInput,
  setLastMagicLinkResponse,
  setSyncConflicts,
  getActiveConflictNoteId,
  setActiveConflictNoteId,
  getActiveConflictDetail,
  setActiveConflictDetail,
  getDismissingConflictNoteIds,
  setDismissingConflictNoteIds,
  getResolvingConflictNoteIds,
  setResolvingConflictNoteIds,
  setSyncUiError,
  setSyncUiMessage,
  setIsSavingVault,
  setIsRequestingMagicLink,
  setIsCompletingSyncSignIn,
  setIsSyncingNow,
  setIsTogglingSyncPause,
  setIsSigningOutSync,
  setIsLoadingConflictDetail,
  loadSemanticState,
  loadForgottenNotes
}: SyncSettingsControllerDeps) {
  async function saveVaultDirectory() {
    setIsSavingVault(true);

    try {
      setVaultInfo(
        await invoke<VaultInfo>('set_vault_directory', {
          path: getVaultPathInput().trim() === '' ? null : getVaultPathInput().trim()
        })
      );
      setSyncStatus(await invoke<SyncStatus>('get_sync_status'));
    } catch (error) {
      console.error('Failed to save vault directory:', error);
    } finally {
      setIsSavingVault(false);
    }
  }

  async function requestMagicLink() {
    if (getSyncBaseUrlInput().trim() === '' || getSyncEmailInput().trim() === '') return;
    setIsRequestingMagicLink(true);
    setSyncUiError(null);
    setSyncUiMessage(null);

    try {
      const response = await invoke<RequestMagicLinkResponse>('request_sync_magic_link', {
        syncBaseUrl: getSyncBaseUrlInput().trim(),
        email: getSyncEmailInput().trim()
      });
      setLastMagicLinkResponse(response);
      if (response.magicLinkToken) {
        setMagicLinkTokenInput(response.magicLinkToken);
      }
      setSyncStatus(await invoke<SyncStatus>('get_sync_status'));
      setSyncUiMessage('Magic link requested.');
    } catch (error) {
      console.error('Failed to request magic link:', error);
      setSyncUiError(String(error));
    } finally {
      setIsRequestingMagicLink(false);
    }
  }

  async function completeSyncSignIn() {
    if (
      getSyncBaseUrlInput().trim() === '' ||
      getSyncEmailInput().trim() === '' ||
      getMagicLinkTokenInput().trim() === ''
    ) {
      return;
    }

    setIsCompletingSyncSignIn(true);
    setSyncUiError(null);
    setSyncUiMessage(null);
    try {
      setSyncStatus(
        await invoke<SyncStatus>('complete_sync_sign_in', {
          syncBaseUrl: getSyncBaseUrlInput().trim(),
          email: getSyncEmailInput().trim(),
          magicLinkToken: getMagicLinkTokenInput().trim(),
          deviceName: navigator.platform || null
        })
      );
      await loadSemanticState();
      setSyncUiMessage('This device is linked and ready to sync.');
    } catch (error) {
      console.error('Failed to complete sync sign-in:', error);
      setSyncUiError(String(error));
    } finally {
      setIsCompletingSyncSignIn(false);
    }
  }

  async function runSyncNow() {
    setIsSyncingNow(true);
    setSyncUiError(null);
    setSyncUiMessage(null);
    try {
      setSyncStatus(await invoke<SyncStatus>('sync_now'));
      await loadForgottenNotes();
      await loadSemanticState();
      setSyncUiMessage('Sync completed.');
    } catch (error) {
      console.error('Failed to sync:', error);
      setSyncUiError(String(error));
      await loadSemanticState();
    } finally {
      setIsSyncingNow(false);
    }
  }

  async function signOutSync(keepServerUrl = true) {
    setIsSigningOutSync(true);
    setSyncUiError(null);
    setSyncUiMessage(null);
    try {
      setSyncStatus(await invoke<SyncStatus>('sign_out_sync', { keepServerUrl }));
      setMagicLinkTokenInput('');
      setLastMagicLinkResponse(null);
      setSyncConflicts(await invoke<SyncConflict[]>('list_sync_conflicts'));
      setSyncUiMessage('Signed out on this device.');
    } catch (error) {
      console.error('Failed to sign out of sync:', error);
      setSyncUiError(String(error));
    } finally {
      setIsSigningOutSync(false);
    }
  }

  async function dismissSyncConflict(noteId: string) {
    setDismissingConflictNoteIds(Array.from(new Set([...getDismissingConflictNoteIds(), noteId])));
    setSyncUiError(null);
    try {
      setSyncStatus(await invoke<SyncStatus>('dismiss_sync_conflict', { noteId }));
      setSyncConflicts(await invoke<SyncConflict[]>('list_sync_conflicts'));
      if (getActiveConflictNoteId() === noteId) {
        setActiveConflictNoteId(null);
        setActiveConflictDetail(null);
      }
    } catch (error) {
      console.error('Failed to dismiss sync conflict:', error);
      setSyncUiError(String(error));
    } finally {
      setDismissingConflictNoteIds(getDismissingConflictNoteIds().filter((id) => id !== noteId));
    }
  }

  async function toggleSyncConflictDetail(noteId: string) {
    if (getActiveConflictNoteId() === noteId) {
      setActiveConflictNoteId(null);
      setActiveConflictDetail(null);
      return;
    }

    setIsLoadingConflictDetail(true);
    setSyncUiError(null);
    try {
      const detail = await invoke<SyncConflictDetail | null>('get_sync_conflict_detail', {
        noteId
      });
      setActiveConflictDetail(detail);
      setActiveConflictNoteId(detail ? noteId : null);
    } catch (error) {
      console.error('Failed to load sync conflict detail:', error);
      setSyncUiError(String(error));
      setActiveConflictNoteId(null);
      setActiveConflictDetail(null);
    } finally {
      setIsLoadingConflictDetail(false);
    }
  }

  async function resolveSyncConflict(noteId: string, strategy: 'keep-local' | 'keep-remote') {
    setResolvingConflictNoteIds(Array.from(new Set([...getResolvingConflictNoteIds(), noteId])));
    setSyncUiError(null);
    setSyncUiMessage(null);
    try {
      setSyncStatus(
        await invoke<SyncStatus>(
          strategy === 'keep-local'
            ? 'resolve_sync_conflict_keep_local'
            : 'resolve_sync_conflict_keep_remote',
          { noteId }
        )
      );
      setSyncConflicts(await invoke<SyncConflict[]>('list_sync_conflicts'));
      if (getActiveConflictNoteId() === noteId) {
        setActiveConflictNoteId(null);
        setActiveConflictDetail(null);
      }
      setSyncUiMessage(
        strategy === 'keep-local'
          ? 'Conflict resolved by restoring the local version to the canonical note.'
          : 'Conflict resolved by keeping the remote canonical version.'
      );
      await loadSemanticState();
    } catch (error) {
      console.error('Failed to resolve sync conflict:', error);
      setSyncUiError(String(error));
    } finally {
      setResolvingConflictNoteIds(getResolvingConflictNoteIds().filter((id) => id !== noteId));
    }
  }

  async function toggleSyncPaused() {
    const syncStatus = getSyncStatus();
    if (!syncStatus) return;

    setIsTogglingSyncPause(true);
    setSyncUiError(null);
    setSyncUiMessage(null);
    try {
      const nextStatus = await invoke<SyncStatus>('set_sync_paused', {
        paused: !syncStatus.paused
      });
      setSyncStatus(nextStatus);
      setSyncUiMessage(
        nextStatus.paused
          ? 'Syncing is paused on this device.'
          : 'Syncing resumed on this device.'
      );
      if (!nextStatus.paused) {
        await loadSemanticState();
      }
    } catch (error) {
      console.error('Failed to toggle sync pause:', error);
      setSyncUiError(String(error));
    } finally {
      setIsTogglingSyncPause(false);
    }
  }

  return {
    saveVaultDirectory,
    requestMagicLink,
    completeSyncSignIn,
    runSyncNow,
    signOutSync,
    dismissSyncConflict,
    toggleSyncConflictDetail,
    resolveSyncConflict,
    toggleSyncPaused
  };
}

export function formatSyncTimestamp(value: number | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export function buildConflictDiffRows(detail: SyncConflictDetail | null) {
  if (!detail) return [] as ConflictDiffRow[];
  const localLines = detail.localMarkdown.replace(/\r\n/g, '\n').split('\n');
  const remoteLines = detail.remoteMarkdown.replace(/\r\n/g, '\n').split('\n');
  const length = Math.max(localLines.length, remoteLines.length);
  const rows: ConflictDiffRow[] = [];

  for (let index = 0; index < length; index += 1) {
    const localLine = localLines[index] ?? '';
    const remoteLine = remoteLines[index] ?? '';
    let kind: ConflictDiffRow['kind'] = 'same';
    if (index >= localLines.length) {
      kind = 'remote-only';
    } else if (index >= remoteLines.length) {
      kind = 'local-only';
    } else if (localLine !== remoteLine) {
      kind = 'changed';
    }

    rows.push({
      lineNumber: index + 1,
      localLine,
      remoteLine,
      kind
    });
  }

  return rows;
}

export function conflictRowClass(kind: ConflictDiffRow['kind']) {
  switch (kind) {
    case 'changed':
      return 'bg-amber-50 dark:bg-amber-950/20';
    case 'local-only':
      return 'bg-emerald-50 dark:bg-emerald-950/20';
    case 'remote-only':
      return 'bg-sky-50 dark:bg-sky-950/20';
    default:
      return '';
  }
}

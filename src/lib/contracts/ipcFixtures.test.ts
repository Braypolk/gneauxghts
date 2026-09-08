import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

interface CommandFixture {
  args: Record<string, unknown> | null;
  result?: unknown;
  resultFixture?: string;
}

interface CommandContractFixture {
  version: number;
  commands: Record<string, CommandFixture>;
}

interface AppEventContractFixture {
  version: number;
  events: Array<{ channel: string; payload: unknown }>;
}

function readFixture<T>(fileName: string): T {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../src-tauri/test-fixtures/contracts/${fileName}`,
        import.meta.url
      ).pathname,
      'utf8'
    )
  ) as T;
}

const commandFixture = readFixture<CommandContractFixture>('command-payloads.json');
const eventFixture = readFixture<AppEventContractFixture>('app-events.json');

describe('Rust-owned IPC contract fixtures', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('pins note save and session-clear argument names', async () => {
    const { clearLastOpenedNote, saveNoteSession, saveTaskNoteSession } = await import(
      '$lib/features/notepad/session/session'
    );
    const save = commandFixture.commands.save_note;
    const taskSave = commandFixture.commands.save_task_note;

    invokeMock.mockResolvedValueOnce(save.result);
    await saveNoteSession(
      save.args!.title as string,
      save.args!.markdown as string,
      save.args!.currentPath as string
    );
    expect(invokeMock).toHaveBeenLastCalledWith('save_note', save.args);

    invokeMock.mockResolvedValueOnce(save.result);
    await saveTaskNoteSession(
      taskSave.args!.title as string,
      taskSave.args!.markdown as string,
      taskSave.args!.currentPath as string
    );
    expect(invokeMock).toHaveBeenLastCalledWith(
      'save_task_note',
      taskSave.args
    );

    invokeMock.mockResolvedValueOnce(null);
    await clearLastOpenedNote();
    expect(invokeMock).toHaveBeenLastCalledWith(
      'clear_last_opened_note'
    );
  });

  it('pins nested chat send and proposal commit argument names', async () => {
    const { TauriChatApi } = await import('$lib/features/chat/api');
    const api = new TauriChatApi();
    const send = commandFixture.commands.chat_send_message;
    const commit = commandFixture.commands.commit_agent_proposal;

    invokeMock.mockResolvedValueOnce(send.result);
    await api.sendMessage(
      send.args!.request as Parameters<(typeof api)['sendMessage']>[0]
    );
    expect(invokeMock).toHaveBeenLastCalledWith('chat_send_message', send.args);

    invokeMock.mockResolvedValueOnce(commit.result);
    await api.commitAgentProposal(
      commit.args!.proposalId as string,
      commit.args!.markdown as string
    );
    expect(invokeMock).toHaveBeenLastCalledWith('commit_agent_proposal', commit.args);
  });

  it('pins dirty-document task prepare argument and result names', async () => {
    const {
      createDocumentState,
      updateDocumentMarkdown
    } = await import(
      '$lib/features/notepad/document/documentState'
    );
    const { createEmptySessionSnapshot } = await import(
      '$lib/features/notepad/session/session'
    );
    const { createOpenDocumentTaskMutationHandler } =
      await import(
        '$lib/features/tasks/openDocumentTaskMutation'
    );
    const prepare =
      commandFixture.commands.prepare_task_document_mutation;
    const preparedResult = prepare.result as Record<
      string,
      unknown
    >;
    const document = createDocumentState(
      {
        ...createEmptySessionSnapshot(),
        title: 'Tasks',
        bodyMarkdown: '- [ ] Ship it',
        currentNoteId: preparedResult.noteId as string,
        currentNotePath: preparedResult.notePath as string,
        lastSavedTitle: 'Tasks',
        lastSavedMarkdown: '- [ ] Ship it',
        lastSavedNoteId: preparedResult.noteId as string,
        lastSavedPath: preparedResult.notePath as string
      },
      'document:tasks'
    );
    updateDocumentMarkdown(
      document,
      prepare.args!.workingMarkdown as string
    );
    const replaceMarkdown = vi.fn(
      async (_document, markdown: string) => {
        updateDocumentMarkdown(document, markdown);
      }
    );
    const saveDocument = vi.fn(async () => undefined);
    const handler = createOpenDocumentTaskMutationHandler({
      findReferencedDocument: () => document,
      replaceMarkdown,
      saveDocument
    });

    invokeMock.mockResolvedValueOnce(prepare.result);
    await expect(
      handler({
        kind: prepare.args!.mutationKind as 'toggle',
        taskId: prepare.args!.taskId as string,
        noteId: preparedResult.noteId as string,
        notePath: preparedResult.notePath as string
      })
    ).resolves.toEqual({
      status: 'applied-to-open-document'
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'prepare_task_document_mutation',
      prepare.args
    );
    expect(replaceMarkdown).toHaveBeenCalledWith(
      document,
      preparedResult.updatedEditorMarkdown
    );
    expect(saveDocument).toHaveBeenCalledWith(document);
  });

  it('links the semantic status command to the typed event payload fixture', async () => {
    const { retrySemanticIndex } = await import(
      '$lib/features/settings/loaders/semanticLoader'
    );
    const { AppStore } = await import('$lib/app/appStore.svelte');
    const statusEvent = eventFixture.events.find(
      ({ channel }) => channel === 'semantic-status-changed'
    );

    expect(commandFixture.commands.get_semantic_status).toEqual({
      args: null,
      resultFixture: 'app-events.json#semantic-status-changed'
    });
    expect(statusEvent).toBeDefined();

    invokeMock.mockResolvedValueOnce(statusEvent!.payload);
    const store = new AppStore();
    await store.refreshSemanticStatus();
    expect(store.semanticStatus).toEqual(statusEvent!.payload);
    expect(invokeMock).toHaveBeenLastCalledWith('get_semantic_status');

    invokeMock.mockResolvedValueOnce(
      commandFixture.commands.retry_semantic_index.result
    );
    await retrySemanticIndex();
    expect(invokeMock).toHaveBeenLastCalledWith('retry_semantic_index');
  });

  it('records all high-value command families in a versioned fixture', () => {
    expect(commandFixture.version).toBe(1);
    expect(eventFixture.version).toBe(1);
    expect(Object.keys(commandFixture.commands)).toEqual(
      expect.arrayContaining([
        'save_note',
        'clear_last_opened_note',
        'prepare_task_document_mutation',
        'chat_send_message',
        'commit_agent_proposal',
        'set_semantic_settings',
        'get_semantic_status',
        'retry_semantic_index'
      ])
    );
  });
});

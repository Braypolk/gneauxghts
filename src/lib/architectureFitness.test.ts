import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(
  new URL('../../', import.meta.url)
);

function sourceFile(relativePath: string) {
  const absolutePath = `${repositoryRoot}/${relativePath}`;
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function sourceText(relativePath: string) {
  return readFileSync(
    `${repositoryRoot}/${relativePath}`,
    'utf8'
  );
}

function propertyName(
  name: ts.PropertyName | ts.BindingName | undefined
): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

function interfaceProperties(
  relativePath: string,
  interfaceName: string
) {
  const source = sourceFile(relativePath);
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === interfaceName
  );
  if (!declaration) {
    throw new Error(
      `Missing ${interfaceName} interface in ${relativePath}`
    );
  }
  return declaration.members
    .map((member) => propertyName(member.name))
    .filter((name): name is string => name !== null);
}

function classProperties(
  relativePath: string,
  className: string
) {
  const source = sourceFile(relativePath);
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) &&
      statement.name?.text === className
  );
  if (!declaration) {
    throw new Error(`Missing ${className} class in ${relativePath}`);
  }
  return declaration.members
    .filter(ts.isPropertyDeclaration)
    .map((member) => propertyName(member.name))
    .filter((name): name is string => name !== null);
}

function stateObjectProperties(
  relativePath: string,
  variableName: string
) {
  const source = sourceFile(relativePath);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== variableName ||
        !declaration.initializer ||
        !ts.isCallExpression(declaration.initializer)
      ) {
        continue;
      }
      const stateValue = declaration.initializer.arguments[0];
      if (!stateValue || !ts.isObjectLiteralExpression(stateValue)) {
        throw new Error(
          `${variableName} must be initialized from a direct state object`
        );
      }
      return stateValue.properties
        .map((property) => propertyName(property.name))
        .filter((name): name is string => name !== null);
    }
  }
  throw new Error(`Missing ${variableName} in ${relativePath}`);
}

describe('architecture fitness: notepad state ownership', () => {
  const paneMirrorFields = [
    'paneOrder',
    'activePaneId',
    'panesById',
    'paneKindsById',
    'paneKindById',
    'paneNoteKeys',
    'noteKeysByPane',
    'paneNoteKeyById',
    'chatConversationIdsByPane'
  ];

  it('keeps pane structure and pane-to-content references in WorkspaceStore', () => {
    const workspaceFields = classProperties(
      'src/lib/features/notepad/workspace/workspaceStore.svelte.ts',
      'WorkspaceStore'
    );
    const runtimeFields = stateObjectProperties(
      'src/lib/features/notepad/session/runtimeStore.svelte.ts',
      'notepadRuntimeState'
    );
    const noteStoreFields = interfaceProperties(
      'src/lib/features/notepad/state/noteStore.ts',
      'NotepadState'
    );

    expect(workspaceFields).toEqual(
      expect.arrayContaining([
        'paneOrder',
        'activePaneId',
        'panesById'
      ])
    );
    expect(
      runtimeFields.filter((field) =>
        paneMirrorFields.includes(field)
      )
    ).toEqual([]);
    expect(
      noteStoreFields.filter((field) =>
        paneMirrorFields.includes(field)
      )
    ).toEqual([]);
  });

  it('keeps NoteDraftState structured instead of restoring legacy flat fields', () => {
    const fields = interfaceProperties(
      'src/lib/features/notepad/document/documentState.ts',
      'NoteDraftState'
    );

    expect(fields).toEqual([
      'key',
      'working',
      'identity',
      'savedBaseline',
      'operation',
      'externalSync'
    ]);
  });
});

describe('architecture fitness: content operation machines', () => {
  it('keeps chat operation booleans as derived projections', () => {
    const controller = sourceText(
      'src/lib/features/chat/controller.svelte.ts'
    );
    const fields = classProperties(
      'src/lib/features/chat/controller.svelte.ts',
      'ChatControllerStore'
    );

    expect(fields).toEqual(
      expect.arrayContaining(['machine'])
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        'controllerLifecycle',
        'selectionOperation',
        'requestOperation',
        'isInitializing',
        'isLoadingConversation',
        'isSending',
        'activity'
      ])
    );
    expect(controller).toContain(
      'const request = this.machine.request'
    );
    expect(controller).not.toContain(
      'this.conversation?.activeRequestId'
    );
    expect(controller).not.toContain(
      'sequence !== this.#initializeSequence'
    );
  });

  it('routes document exits through the shared departure phase', () => {
    const noteCommands = sourceText(
      'src/lib/features/notepad/orchestration/noteCommandController.ts'
    );
    const workspaceCommands = sourceText(
      'src/lib/features/notepad/orchestration/workspacePaneController.ts'
    );
    const session = sourceText(
      'src/lib/features/notepad/session/session.ts'
    );

    expect(noteCommands).toContain(
      'deps.documentDeparture.prepare'
    );
    expect(workspaceCommands).toContain(
      'deps.documentDeparture.prepare'
    );
    expect(session).not.toContain('remember_note');
    expect(noteCommands).not.toContain("operation: 'opening'");
    expect(noteCommands).not.toContain('bumpOpenRequestGeneration');
    expect(noteCommands).not.toContain('getOpenRequestGeneration');
  });
});

describe('architecture fitness: document external-sync machine', () => {
  it('keeps external-sync transitions behind the reducer boundary', () => {
    const machine = sourceText(
      'src/lib/features/notepad/document/documentExternalSyncMachine.ts'
    );
    const documentState = sourceText(
      'src/lib/features/notepad/document/documentState.ts'
    );
    const conflictController = sourceText(
      'src/lib/features/notepad/document/documentConflictController.ts'
    );

    expect(machine).toContain(
      'transitionDocumentExternalSync'
    );
    expect(machine).toContain("phase: 'awaitingChoice'");
    expect(machine).toContain("phase: 'applyingExternal'");
    expect(machine).not.toContain("kind: 'inSync'");
    expect(machine).not.toContain("kind: 'dirty'");
    expect(machine).not.toContain("type: 'workingChanged'");
    expect(documentState).toContain(
      '!documentHasCleanBuffer(document)'
    );
    expect(
      documentState.match(/document\.externalSync\s*=/g) ?? []
    ).toHaveLength(1);
    expect(documentState).toContain(
      'transitionDocumentExternalSync('
    );
    for (const removedWrapper of [
      'captureExternalSnapshotConflict',
      'captureExternalDeletionConflict',
      'resolveConflictKeepingWorking',
      'beginApplyingExternalConflict',
      'failApplyingExternalConflict',
      'isApplyingExternalConflictCurrent'
    ]) {
      expect(documentState).not.toContain(removedWrapper);
    }
    expect(conflictController).not.toMatch(
      /document\.externalSync\s*=/
    );
  });
});

describe('architecture fitness: pane lifecycle machine', () => {
  it('owns membership and editor-runtime transitions without legacy lifecycle commands', () => {
    const machine = sourceText(
      'src/lib/features/notepad/pane/paneLifecycleMachine.ts'
    );
    const workspace = sourceText(
      'src/lib/features/notepad/workspace/workspaceStore.svelte.ts'
    );
    const editorLifecycle = sourceText(
      'src/lib/features/notepad/pane/paneEditorLifecycle.ts'
    );

    expect(machine).toContain('transitionPaneMembership');
    expect(machine).toContain('transitionPaneEditorRuntime');
    expect(workspace).toContain('transitionPaneMembership(');
    expect(editorLifecycle).toContain(
      'transitionPaneEditorRuntime('
    );
    expect(editorLifecycle).not.toContain('#disposed');
    expect(editorLifecycle).not.toContain(
      'synchronizeMountedResource'
    );
    expect(editorLifecycle).toContain(
      'assertStableResourceInvariant'
    );
    expect(workspace).not.toContain('retiringPanesById');
    expect(
      workspace.match(/paneMembershipById\.set\(/g) ?? []
    ).toHaveLength(2);
    expect(
      editorLifecycle.match(/this\.#state\s*=/g) ?? []
    ).toHaveLength(1);
    for (const removedCommand of [
      'addPane(',
      'removePane(',
      'finalizePaneRemoval('
    ]) {
      expect(workspace).not.toContain(removedCommand);
    }
  });
});

describe('architecture fitness: proposal review workflow', () => {
  it('has one workflow owner and no legacy review flags or hold store', () => {
    const machine = sourceText(
      'src/lib/features/proposals/proposalReviewMachine.ts'
    );
    const session = sourceText(
      'src/lib/features/proposals/reviewSession.svelte.ts'
    );
    const orchestration = sourceText(
      'src/lib/features/proposals/proposalOrchestration.ts'
    );

    for (const phase of [
      'opening',
      'reviewing',
      'committing',
      'dismissing',
      'conflicted'
    ]) {
      expect(machine).toContain(`'${phase}'`);
    }
    expect(session).toContain(
      'transitionProposalReviewWorkflow(workflow, event)'
    );
    expect(orchestration).not.toMatch(
      /\b(committing|conflicted|reloadConfirming): boolean/
    );
    expect(orchestration).not.toContain('let active:');
    expect(session).not.toContain('setApplying');
    expect(session).not.toContain('setConflicted');
    expect(session).not.toContain('activeChangeId');
    expect(session).not.toContain('setReviewHunks');
    expect(orchestration).not.toContain('showChange:');
    expect(orchestration).not.toContain('keep: (');
    expect(orchestration).not.toContain('undo: (');
    expect(machine).not.toContain('attachmentChanged');
    expect(orchestration).not.toContain('reviewHold');
    expect(machine).toContain("kind: 'confirmingDiscard'");
    expect(machine).not.toContain('discardConfirmation');
  });
});

describe('architecture fitness: NoteDraftState consumers', () => {
  it('does not access removed flat fields on typed NoteDraftState values', () => {
    const configPath = `${repositoryRoot}/tsconfig.json`;
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) {
      throw new Error(
        ts.flattenDiagnosticMessageText(
          config.error.messageText,
          '\n'
        )
      );
    }
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      repositoryRoot
    );
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const checker = program.getTypeChecker();
    const legacyFields = new Set([
      'title',
      'bodyMarkdown',
      'markdown',
      'currentNoteId',
      'currentNotePath',
      'lastSavedTitle',
      'lastSavedMarkdown',
      'lastSavedNoteId',
      'lastSavedPath',
      'isSaving',
      'isRemembering',
      'isForgetting'
    ]);
    const violations: string[] = [];

    function isNoteDraftState(
      type: ts.Type,
      visited = new Set<ts.Type>()
    ): boolean {
      if (visited.has(type)) return false;
      visited.add(type);
      if (
        type.symbol?.name === 'NoteDraftState' ||
        type.aliasSymbol?.name === 'NoteDraftState'
      ) {
        return true;
      }
      return type.isUnionOrIntersection()
        ? type.types.some((member) =>
            isNoteDraftState(member, visited)
          )
        : false;
    }

    for (const source of program.getSourceFiles()) {
      const normalizedPath = source.fileName.replaceAll('\\', '/');
      if (
        !normalizedPath.startsWith(
          `${repositoryRoot}/src/lib/`
        ) ||
        normalizedPath.includes('.test.')
      ) {
        continue;
      }

      function visit(node: ts.Node) {
        let receiver: ts.Expression | null = null;
        let field: string | null = null;
        if (ts.isPropertyAccessExpression(node)) {
          receiver = node.expression;
          field = node.name.text;
        } else if (
          ts.isElementAccessExpression(node) &&
          node.argumentExpression &&
          ts.isStringLiteral(node.argumentExpression)
        ) {
          receiver = node.expression;
          field = node.argumentExpression.text;
        }

        if (
          receiver &&
          field &&
          legacyFields.has(field) &&
          isNoteDraftState(checker.getTypeAtLocation(receiver))
        ) {
          const position = source.getLineAndCharacterOfPosition(
            node.getStart(source)
          );
          violations.push(
            `${normalizedPath.slice(repositoryRoot.length + 1)}:${position.line + 1} ${node.getText(source)}`
          );
        }
        ts.forEachChild(node, visit);
      }

      visit(source);
    }

    expect(violations).toEqual([]);
  });
});

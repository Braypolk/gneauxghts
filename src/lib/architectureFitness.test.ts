import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const notepad = 'src/lib/features/notepad/';
const parse = (text: string, path = 'probe.ts') => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const source = (path: string) => parse(readFileSync(`${root}/${path}`, 'utf8'), path);
function nodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root); return found;
}
function name(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node))) return node.text;
}
function member(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return name(node.name);
  if (ts.isElementAccessExpression(node)) return name(node.argumentExpression);
}
function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;
}
function callName(node: ts.CallExpression) { return name(unwrap(node.expression)) ?? member(unwrap(node.expression)); }
function calls(tree: ts.Node, called: string) { return nodes(tree, ts.isCallExpression).filter(node => callName(node) === called); }
function declarations(path: string, type: 'class' | 'interface', declarationName: string) {
  const tree = source(path);
  const declaration = type === 'class'
    ? nodes(tree, ts.isClassDeclaration).find(node => node.name?.text === declarationName)
    : nodes(tree, ts.isInterfaceDeclaration).find(node => node.name.text === declarationName);
  if (!declaration) throw new Error(`Missing ${declarationName} in ${path}`);
  return declaration.members;
}
function fields(path: string, type: 'class' | 'interface', declarationName: string) {
  return declarations(path, type, declarationName)
    .filter(node => type === 'interface' || ts.isPropertyDeclaration(node))
    .map(node => name(node.name)).filter((field): field is string => !!field);
}
function stateFields(path: string, stateName: string) {
  const declaration = nodes(source(path), ts.isVariableDeclaration).find(node => name(node.name) === stateName);
  if (!declaration?.initializer || !ts.isCallExpression(declaration.initializer)) throw new Error(`Missing ${stateName}`);
  const value = declaration.initializer.arguments[0];
  if (!value || !ts.isObjectLiteralExpression(value)) throw new Error(`Expected state object for ${stateName}`);
  return value.properties.map(node => name(node.name));
}
function writes(tree: ts.Node, field: string) {
  return nodes(tree, ts.isBinaryExpression).filter(node =>
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && member(unwrap(node.left)) === field);
}
function usesIdentifier(tree: ts.Node, identifier: string) {
  return nodes(tree, ts.isIdentifier).some(node => node.text === identifier);
}
function productionSources(directory: string): ts.SourceFile[] {
  return readdirSync(`${root}/${directory}`, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return productionSources(path);
    // Test fixtures are not production ownership. Svelte components are checked
    // behaviorally; these guards concern TypeScript state/controller boundaries.
    if (!entry.name.endsWith('.ts') || /(?:\.test|\.bench|TestSupport|TestFixture|testSupport|testFixtures|ReactiveFixture)\./.test(entry.name)) return [];
    return [source(path)];
  });
}
function initializer(identifier: ts.Identifier): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (name(declaration.name) === identifier.text) return declaration.initializer;
      }
    }
  }
}
function derivesPaneKind(expression: ts.Expression, seen = new Set<ts.Node>()): boolean {
  const node = unwrap(expression);
  if (seen.has(node)) return false;
  seen.add(node);
  if (ts.isCallExpression(node)) return callName(node) === 'getPaneKind';
  if (ts.isIdentifier(node)) { const value = initializer(node); return !!value && derivesPaneKind(value, seen); }
  return false;
}
function paneKindComparisons(tree: ts.Node) {
  const equalities = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
  const isKind = (node: ts.Expression) => ['editor', 'chat'].includes(name(unwrap(node)) ?? '');
  return nodes(tree, ts.isBinaryExpression).filter(node => equalities.has(node.operatorToken.kind) &&
    ((isKind(node.left) && derivesPaneKind(node.right)) || (isKind(node.right) && derivesPaneKind(node.left))));
}
const positions = (tree: ts.SourceFile, matches: ts.Node[]) => matches.map(node => `${tree.fileName}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);

describe('architecture fitness: state ownership', () => {
  it('keeps pane membership and references in WorkspaceStore', () => {
    const mirrorFields = ['paneOrder', 'activePaneId', 'panesById', 'paneKindsById', 'paneKindById', 'paneNoteKeys', 'noteKeysByPane', 'paneNoteKeyById', 'chatConversationIdsByPane'];
    expect(fields(`${notepad}workspace/workspaceStore.svelte.ts`, 'class', 'WorkspaceStore')).toEqual(expect.arrayContaining(['paneOrder', 'activePaneId', 'panesById']));
    for (const owner of [stateFields(`${notepad}session/runtimeStore.svelte.ts`, 'notepadRuntimeState'), fields(`${notepad}state/noteStore.ts`, 'interface', 'NotepadState')]) {
      expect(owner.filter(field => field && mirrorFields.includes(field))).toEqual([]);
    }
  });
  it('keeps global History Mode outside pane and document owners', () => {
    for (const path of ['workspace/workspaceStore.svelte.ts', 'workspace/paneTypes.ts', 'state/noteStore.ts', 'document/documentRuntime.ts']) {
      expect(usesIdentifier(source(notepad + path), 'HistoryModeSession'), path).toBe(false);
    }
    const paneKinds = nodes(source(`${notepad}workspace/paneTypes.ts`), ts.isTypeAliasDeclaration).find(node => node.name.text === 'PaneKind');
    expect(paneKinds).toBeDefined();
    expect(nodes(paneKinds!, ts.isLiteralTypeNode).map(node => name(node.literal))).not.toContain('history');
  });

  it('keeps chat operation state in its machine and shared backend snapshots in AppStore', () => {
    const chatFields = fields('src/lib/features/chat/controller.svelte.ts', 'class', 'ChatControllerStore');
    expect(chatFields.filter(field => [
      'machine', 'controllerLifecycle', 'selectionOperation', 'requestOperation',
      'settings', 'conversations', 'conversationDraft', 'conversation', 'proposals',
      'modelCapabilities', 'isInitializing', 'isLoadingConversation', 'isSending', 'activity'
    ].includes(field.replace(/^#/, '')))).toEqual([]);
    const settingsFields = fields('src/lib/features/settings/store.svelte.ts', 'class', 'SettingsStore');
    // Either mirrored snapshot is forbidden, not just the pair together.
    expect(settingsFields.filter(field => ['vaultInfo', 'semanticStatus'].includes(field))).toEqual([]);
  });
});

describe('architecture fitness: reducer and capability boundaries', () => {
  it('routes external-sync writes through the reducer adapter', () => {
    const paths = productionSources(notepad);
    const allWrites = paths.flatMap(tree => writes(tree, 'externalSync').map(write => ({ tree, write })));
    expect(allWrites.length).toBeGreaterThan(0);
    for (const { tree, write } of allWrites) {
      expect(tree.fileName).toBe(`${notepad}document/documentState.ts`);
      const value = ts.isIdentifier(write.right) ? initializer(write.right) : write.right;
      expect(value && calls(value, 'transitionDocumentExternalSync').length).toBe(1);
    }
  });

  it('uses capabilities rather than literal live-pane kind permissions', () => {
    const violations = productionSources(`${notepad}orchestration`).flatMap(tree => positions(tree, paneKindComparisons(tree)));
    expect(violations).toEqual([]);
    const roles = source(`${notepad}workspace/paneRoles.ts`);
    for (const policy of ['paneKindChangeRetainsEditor', 'paneRemovalRetainsEditor']) expect(usesIdentifier(roles, policy)).toBe(false);
  });

});

describe('architecture scanner mutation probes', () => {
  it('requires executable calls; comments, strings and imports cannot satisfy them', () => {
    expect(calls(parse(`// transitionPaneMembership(x, y)\nconst label = 'transitionPaneMembership(x,y)'; import { transitionPaneMembership } from './machine';`), 'transitionPaneMembership')).toHaveLength(0);
    expect(calls(parse(`transitionPaneMembership /* formatting is legal */ ( previous, event );`), 'transitionPaneMembership')).toHaveLength(1);
  });
  it('recognizes reversed, bracketed, parenthesized and local alias permission checks', () => {
    for (const text of [
      `deps.getPaneKind(id) === 'editor'`, `'chat' !== deps['getPaneKind'](id)`,
      `const kind = deps.getPaneKind(id); ('editor') === (kind);`,
      `const first = deps.getPaneKind(id); const next = first; next != 'chat';`
    ]) expect(paneKindComparisons(parse(text)), text).toHaveLength(1);
  });
  it('ignores harmless comments/strings and respects a shadowed local variable', () => {
    expect(paneKindComparisons(parse(`// getPaneKind(id) === 'editor'\nconst text = "getPaneKind(id) === 'chat'"; paneHasCapability(getPaneKind(id), 'edit-document');`))).toHaveLength(0);
    expect(paneKindComparisons(parse(`const kind = getPaneKind(id); function unrelated() { const kind = 'other'; return kind === 'editor'; }`))).toHaveLength(0);
  });
  it('recognizes writes independent of whitespace or property notation', () => {
    expect(writes(parse(`document /* spaced */ ['externalSync'] = transitionDocumentExternalSync(previous, event);`), 'externalSync')).toHaveLength(1);
    expect(writes(parse(`// document.externalSync = wrong;\nconst text = 'document.externalSync = wrong';`), 'externalSync')).toHaveLength(0);
  });
});

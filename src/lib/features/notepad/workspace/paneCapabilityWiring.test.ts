import {
  readFileSync,
  readdirSync
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const orchestrationDirectory = fileURLToPath(
  new URL('../orchestration/', import.meta.url)
);

describe('pane capability orchestration wiring', () => {
  it('does not reintroduce direct live-pane kind permission checks', () => {
    const directComparison =
      /getPaneKind\s*\([^)]*\)\s*(?:===|!==)\s*['"](?:editor|chat)['"]/g;
    const violations: string[] = [];

    for (const file of readdirSync(orchestrationDirectory)) {
      if (
        !file.endsWith('.ts') ||
        file.endsWith('.test.ts')
      ) {
        continue;
      }
      const source = readFileSync(
        `${orchestrationDirectory}/${file}`,
        'utf8'
      );
      for (const match of source.matchAll(directComparison)) {
        const line =
          source.slice(0, match.index).split('\n').length;
        violations.push(`${file}:${line} ${match[0]}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps workspace transition policy out of paneRoles', () => {
    const paneRoles = readFileSync(
      fileURLToPath(new URL('./paneRoles.ts', import.meta.url)),
      'utf8'
    );

    expect(paneRoles).not.toContain(
      'paneKindChangeRetainsEditor'
    );
    expect(paneRoles).not.toContain(
      'paneRemovalRetainsEditor'
    );
  });

  it('does not use presentation readiness to skip document binding', () => {
    const violations: string[] = [];

    for (const file of readdirSync(orchestrationDirectory)) {
      if (
        !file.endsWith('.ts') ||
        file.endsWith('.test.ts')
      ) {
        continue;
      }
      const source = readFileSync(
        `${orchestrationDirectory}/${file}`,
        'utf8'
      );
      if (source.includes('.ui.isEditorReady')) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});

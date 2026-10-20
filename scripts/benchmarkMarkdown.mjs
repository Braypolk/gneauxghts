import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// The baseline includes inherited worktree changes (notably table removal), so
// git HEAD is not an adequate baseline. Restore exact measured source briefly,
// and always restore the caller's current contents, including on command failure.
const [variant = 'after', suite = 'pure'] = process.argv.slice(2);
if (!['before', 'after'].includes(variant) || !['pure', 'mounted', 'full-app', 'all'].includes(suite)) {
  throw new Error('Usage: node scripts/benchmarkMarkdown.mjs before|after pure|mounted|full-app|all');
}
const folder = '.scratch/archive/visible-range-markdown';
const suffix = process.env.MARKDOWN_BENCHMARK_SUFFIX ?? '';
if (!/^[-a-z0-9]*$/.test(suffix)) throw new Error('Benchmark suffix must contain only lowercase letters, digits and hyphens');
const baseline = JSON.parse(readFileSync(`${folder}/before-source.json`, 'utf8'));
const current = new Map(Object.keys(baseline).map(path => [path, readFileSync(path, 'utf8')]));
let status = 0;
function run(args, env) {
  const result = spawnSync('pnpm', ['exec', ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) { status = result.status ?? 1; throw new Error(`Benchmark exited ${status}`); }
}
try {
  if (variant === 'before') for (const [path, source] of Object.entries(baseline)) writeFileSync(path, source);
  if (suite === 'pure' || suite === 'all') run(['vitest', 'run', 'src/lib/features/notepad/markdown/markdownPerformance.test.ts'], {
    MARKDOWN_BENCHMARK_OUTPUT: `${folder}/pure-${variant}${suffix}.json`
  });
  if (suite === 'mounted' || suite === 'all') run(['wdio', 'run', 'e2e/wdio.browser.conf.ts', '--spec', 'e2e/specs/browser/markdown-performance.spec.ts',
    ...(process.env.MARKDOWN_BENCHMARK_GREP ? ['--mochaOpts.grep', process.env.MARKDOWN_BENCHMARK_GREP] : [])], {
    MARKDOWN_MOUNTED_BENCHMARK_OUTPUT: `${folder}/mounted-${variant}${suffix}.json`
  });
  if (suite === 'full-app') run(['wdio', 'run', 'e2e/wdio.browser.conf.ts', '--spec', 'e2e/specs/browser/markdown-full-app-performance.spec.ts',
    ...(process.env.MARKDOWN_BENCHMARK_GREP ? ['--mochaOpts.grep', process.env.MARKDOWN_BENCHMARK_GREP] : [])], {
    MARKDOWN_FULL_APP_OUTPUT: `${folder}/full-app-${variant}${suffix}.json`
  });
} finally {
  if (variant === 'before') for (const [path, source] of current) writeFileSync(path, source);
}
process.exitCode = status;

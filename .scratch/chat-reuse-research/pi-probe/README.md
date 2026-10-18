# Pi portability and editable approval probes

Research fixtures for the [source findings](../pi-mobile-source-findings.md).
Production code does not depend on this directory.

## Run

Use Node >=22.19 with built-in SQLite. From this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run bundle
CHROMIUM_EXECUTABLE='/absolute/path/to/chromium' npm run browser
npm run approval
```

The browser probe uses an isolated headless profile. Set `CHROMIUM_EXECUTABLE`
to an existing Chromium executable; when omitted, Playwright uses its default
installed browser location. `playwright-core` does not download a browser during
installation. Bundle output stays in memory. Approval SQLite files use a unique
temporary directory and are removed after execution.

## Observed on October 15, 2026

- Exact published Pi Durable, Pi AI, and Chord **1.3.0**.
- Core browser bundle succeeded with zero external imports. Selected
  OpenAI/Anthropic provider bundle also succeeded; a guarded Bun-only `node:fs`
  require remained, so this does not establish live browser provider behavior.
- Chromium 145 completed a fake-model Harness conversation using real browser
  globals, without `process` or `Buffer`.
- Node SQLite pending review survived close/reopen. Human-edited text was
  approved and the same submission resumed; the simulated effect executed once.

The preserved scripts add assertions, unique temporary paths, environment-based
browser selection, and cleanup to the successful temporary probes. The lockfile preserves the tested
Pi/esbuild dependency artifacts and the separately used Playwright 1.58.2
artifact, with temporary absolute package paths normalized for portability.

## Packaged-script check, October 17, 2026

Copied the manifest, lockfile and all five scripts into a clean temporary directory
and ran the commands above unchanged, using Playwright's existing Chromium 145
installation. Node 24.2.0/npm 11.3.0 installed 119 packages with lifecycle scripts
disabled. All 93 required package versions matched the retained lockfile, and
installation left the lockfile unchanged.

- `npm run bundle` passed: core output was 988,643 bytes across 761 inputs with
  no external imports. The selected-provider output was 2,597,772 bytes across
  1,117 inputs and retained the documented external `node:fs` require. Neither
  output was written to disk.
- `npm run browser` passed: fake-model submission finished with `pi.user` and
  `pi.assistant` entries; `process` and `Buffer` were undefined. This case loads
  the core bundle, not the selected-provider bundle, and makes no model request.
- `npm run approval` passed: the pending original text survived graceful SQLite
  close/reopen with zero effects, then the original submission completed with
  `edited by human` and exactly one simulated effect. The disposable SQLite
  directory was removed by the packaged cleanup.

The browser closed after execution. Node emitted its built-in experimental SQLite
warning. No production dependency, provider, native app or vault was involved.
This rerun verifies the packaged reproduction, not additional platform or effect
guarantees.

These probes do not establish WKWebView/iOS support, native Tauri storage/HTTP
bridges, real provider behavior, abrupt process-kill recovery, rejection behavior,
concurrent reviews, or exactly-once Markdown publication. The approval state and
watch protocol are custom application logic; Pi supplies durable state and
resumption. A real native write needs its own durable idempotency/receipt design.

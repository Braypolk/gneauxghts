# Automatic AI titles retired — 2026-10-22

The user requested scrapping automatic AI titles after the experiment remained confusing and unreliable in their workflow. Removed the Settings preference, editor title controller/preview/timers/rejection tracking, Pi title task and application-job creation, native title authority/commands/transport branch, and semantic phrase fallback. Saving a note no longer opens Pi or contacts a model for naming.

Ordinary naming is restored: an explicit title wins; otherwise the first nonempty body line supplies the filename/title at save. Existing notes are not bulk-renamed. Captures produced by the retired flow retain their blank visible title on read, then join ordinary naming on their next save with the retired managed marker cleared. Content and Note Identity are preserved. Old title preferences are inert; old internal application-job conversations remain hidden and cannot bind as human chats. No old title task implementation is installed.

Explicit Pi filename editing remains available with its independent Rename grant, exact destination review, no-clobber publication and editor adoption. Atlas relevance, search cues, formatting and recovery work remain independent.

ADR 0013 is marked retired with its original decision retained as history. Current architecture and behavior invariants describe ordinary naming and the absence of background title inference.

## Verification

- 118 focused frontend tests pass across native provider parsing, runtime/conversation lists, explicit rename tooling/review, browser backend, editor persistence and frontend architecture ownership. Svelte and E2E TypeScript checks pass without errors or warnings.
- Native Rust: 3 note-persistence tests pass, including ordinary first-line naming/manual rename and reading/saving a retired blank-title capture with the same identity; 11 transport tests and 16 state tests pass.
- All 19 backend architecture fitness tests pass. Production build passes with the existing large-chunk advisory; `git diff --check` is clean.
- The worktree native artifact passes 13 macOS acceptance cases: 5 provider/editor cases (including a real editor capture → first-line filename with no provider request) and 8 explicit Pi rename cases covering grants, review/discard, collisions, exact folders, publication, citations, recovery and split-editor adoption.
- Native artifact: `src-tauri/target/e2e/debug/gneauxghts`, SHA-256 `cbeed36ff5e75400710a13e21d1f80fadf24df4215df516f7da8983b7383bc35`. Tests use disposable vaults and local HTTP fixtures, without changing user notes or model settings.
- WDIO session `retire-ai-titles`: Settings screenshot inspected, title controls absent, remaining Chat controls present. Exported `e2e/agent/specs/retired-ai-titles.e2e.js` passes a fresh replay after owned session/server cleanup. An initial assertion used an explicit CSS region role that the semantic HTML did not contain; corrected to the visible Save defaults control without weakening the removed-title assertions.

Restart `pnpm tauri dev` from this worktree to load the retired native command surface. Previously running app processes are not force-closed by this work.

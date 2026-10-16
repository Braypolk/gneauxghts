# Bounded physical-removal preparation

> Retained evaluation runbook/evidence supporting the installed app. The historical spec/issues are archived; see [outcome](../archive/pi-durable-chat-evaluation/outcome.md). This record does not authorize production adoption/default migration.

2026-10-15. Ticket [13](../archive/pi-durable-chat-evaluation/issues/13-replacement-proof-and-evaluation-verdict.md)
has a runnable preparation tool, not a completed removal/build/native result.
No native build, application, provider, Git command, or removal of working source
was performed by this worker. Production default wiring remains intact.

[`removal-experiment.py`](../../scripts/pi-prototype/removal-experiment.py)
implements two modes. `plan` only reads the current source. `prepare` creates a
fresh, disjoint comparison tree and physically deletes an explicit allowlist
there. It refuses existing output roots and target caches inside the original
worktree. It never executes subprocesses. Run preparation after source edits
have stopped: it checks copied file hashes against the original source again
and fails if an existing captured file changed during capture.

```sh
python3 -B scripts/pi-prototype/removal-experiment.py plan
python3 -B scripts/pi-prototype/removal-experiment.py prepare \
  --output /private/tmp/pi-removal-final-20261015 \
  --target-cache /private/tmp/pi-removal-target-final-20261015
```

The target cache may be an independently cloned prior cache, supplied by the
native lease owner. It must never be the original target directory: a shared
binary path would destroy the comparison boundary. The source tree links the
existing Node dependency cache when available, and links only the explicit,
separate Cargo target cache. Preparation does not install dependencies or build.
Compiler fingerprint invalidation and final binary provenance remain required
even when caches are warm.

The experiment root contains:

| Artifact | Meaning |
| --- | --- |
| `source/` | Source snapshot with the allowlisted legacy files physically absent. |
| `removed-source/` | Exact removed bytes archived outside the compiled source tree. |
| `source-manifest.json` | SHA-256 and bytes for every originally copied file, including removed files. |
| `removal-ledger.json` | Feature set, conservative Pi module graph, removed file hashes, lexical function-name inventory, retained leaves, copy policy and cache links. |
| `removal.patch` | Unified deletion diff, including missing-final-newline markers. |
| `REPRODUCE.md` | Build and direct native-gate instructions for the exclusive native owner, explicitly unrun. |

Snapshot roots are explicit source/config/test/resource directories. The tool
omits Git data, private scratch data, dependency/build caches, environment and
credential files, private key/certificate/provision files, SQLite data, and stale
application bundles/static application archives. Generated Xcode project source
and retained third-party runtime resources remain available; their hashes belong
to provenance, not claimed removal savings. Source symlinks are refused rather
than followed outside the reviewed source tree.

The removal allowlist covers the old guardrails/permission/coordinator roots,
Rust agent runtime and tools (including research/compaction loops), legacy chat
service and its admission/store/recovery/projection/relocation submodules, and
legacy chat/proposal IPC implementation files. The following remain:

- The Pi facade and its citations, date/time and structured-answer leaves.
- `chat_domain`, `provider_config`, and `proposal_policy`, including the policy
  they still maintain.
- Canonical note evidence/effect services, editor/index services, NoteTimeline,
  secrets access and semantic/runtime services.
- Pi storage/provider/evidence/review/Save/research/compaction/attachment/web/
  transcript adapters and their recovery obligations.
- Shared frontend UI/controller infrastructure and the ordinary default branch
  of native composition. This experiment does not claim those were removed.

Before and after physical removal, the tool traverses external Rust module
declarations using the selected `pi-prototype,e2e-wdio` features and explicit
`#[path]` leaves. Unknown platform predicates stay conservatively reachable.
This mirrors the existing
[`pi_lifecycle_exclusion`](../../src-tauri/tests/pi_lifecycle_exclusion.rs)
source-graph check and refuses any removal reachable in that graph. Inline
modules/macros and all Rust type checking still require the real compiler.
The archived `fn` names are lexical inventory, including tests and inactive
cfg; they are not a compiler function count or reduced-maintenance measurement.

The native owner must build from `source/`, preserve compiler and binary/frontend
receipts, and rerun the exact final desktop/fault/expanded fixture matrix from
that cwd on both compatible and Responses protocols. Run direct gate scripts
against this tree's pinned binary; invoking a wrapper against a different tree
can rebuild the wrong artifact. Check binary hashes before/after execution.
Final iOS/live-provider/default-path regression and paired resource measurements
remain separate requirements; preparation does not satisfy or waive them. The
reduced comparison tree intentionally cannot build the ordinary default runtime
whose source it removed; default regression belongs to the unchanged worktree.

Validation: `python3 -B scripts/pi-prototype/removal-experiment.test.py` passes
seven pure tests covering the real source graph, lexical/cfg handling, isolated
physical deletion and archive provenance, secret/cache omission, preserved
leaves, and fail-closed boundaries. `plan` passes on the current source. No real
comparison tree has been prepared by this worker, and no compiler/native gate or
coordination/resource savings is claimed.

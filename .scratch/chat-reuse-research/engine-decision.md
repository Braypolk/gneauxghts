# Embedded chat engine decision research

> Historical engine-selection research (2026-10-15). The [completed native
> prototype](../archive/pi-durable-native-prototype.md) and [implemented
> rebuild](../archive/pi-chat-rebuild.md) supersede the adoption recommendation
> and proposed work below. The restored [Pi](pi-probe/README.md) and
> [LangGraph](langgraph-probe/README.md) fixtures retain bounded research
> reproductions; original records and retired app source remain in Git at
> `64cc3ff6`. This is not a current execution plan or ownership specification.

Investigated 2026-10-15. Scope: replace generic session and approval machinery while retaining chat inside Gneauxghts on desktop and iOS. Includes source inspection and isolated published-package feasibility tests; it is not a migration, production reliability benchmark, or iOS acceptance result.

User decision, 2026-10-15: proceed with the [Pi Durable native prototype](../pi-durable-prototype/spec.md). LangGraph is outside the implementation scope. Open WebUI supplies design ideas only, with no source-code import planned. The comparison below remains research background rather than the active execution plan.

## Recommendation

**For the current local-first app, Pi Durable is the strongest first experiment for reducing custom session machinery. It is not yet a justified production selection.** Its portable core ran an actual browser conversation, and a separate native SQLite experiment restored an editable pending review and resumed it. Its durable package is only weeks old, explicitly experimental, and has a different extension API from the established Pi coding-agent ecosystem. We would reuse the durable kernel and write a small Gneauxghts extension; we would not automatically acquire a mature mobile approval product.

**If a shared backend becomes acceptable, LangGraph plus LangChain's human-review middleware is the strongest inspected route to replacing both generic execution and approval coordination.** It supplies persisted workflow state and approve/edit/reject decisions. The interface can remain entirely inside Gneauxghts. This trades local execution for a service and requires a carefully designed local-note tool bridge. Browser availability alone does not establish the same approval support on-device: the standard dynamic interrupt failed in our actual browser test.

**No inspected option establishes an already supported, mature, drop-in on-device desktop+iOS engine that replaces all four areas: conversations, restart recovery, editable approval, and mutable-note evidence.** This is a scoped finding, not proof that no such engine exists. It argues for one bounded native-bridge experiment before more general chat infrastructure work.

Detailed primary-source investigations: [Pi](pi-mobile-source-findings.md), [native engines](native-engine-source-findings.md), [evidence](evidence-source-findings.md), and the earlier [broad product scan](product-findings.md). Those records include source/release pins and qualifications. The recommendation above is our inference from those findings.

## Comparison against the actual requirement

“Local” below means execution inside the device. Calling a remote AI model does not by itself make session management server-hosted. “Server” means a separate backend owns conversation execution/checkpoints; the existing native chat interface can still be retained.

| Candidate | What it could take over | Approval capability | Desktop/iOS assessment | Decision |
| --- | --- | --- | --- | --- |
| **Pi Durable 1.3.0** | Input admission, session/transcript/task persistence, committed projections, model/tool checkpoints, replay policy, compaction, cancellation | Durable documents/tasks support a custom persisted editable review; no ready human-interrupt protocol found | Core passed real Chromium execution. Portable SQLite interface can bridge Rust. WKWebView, native IPC, providers and iOS lifecycle untested | **First local experiment; substantial maturity risk** |
| **LangGraph JS 1.5.0 + LangChain review middleware** | Workflow/thread state, execution checkpoints, resume/retry and model/tool orchestration | Explicit persisted interrupt and approve/edit/reject middleware on supported runtime | Browser bundle works, standard dynamic interrupt failed without async-context support. Static pause/reload worked, but upstream discourages static HITL. Server runtime avoids that browser limitation | **Strongest combined replacement if a backend is acceptable** |
| **Full Goose v1.54.0** | SQLite session CRUD/messages, compaction, permission inspections, persisted confirmation requests/decisions and recovery | Permission approvals are real; edited replacement tool arguments are not its inspected confirmation payload | Desktop-oriented engine. Official iOS is a client to desktop Goose. Local iOS integration unverified; dependencies/API extraction required | Better desktop/server option than first local-mobile bet |
| **goose-agent alpha.12 / goose-sdk** | Portable re-entrant loop and provider abstractions | Full Goose approval operations are not exported by the small package; host supplies session/effect ownership | WASM tests establish portability work, not durable iOS sessions | Less custom-code deletion than the name suggests |
| **Existing Rig 0.44 AgentRun** | Serializable model/tool turn state already available in our pinned dependency | Approval and durable storage remain host responsibilities | Lowest integration cost; current native stack already uses Rig | Baseline and fallback, rather than large session replacement |
| **AI SDK** | Providers, streaming/tool/message types, approval protocol and evidence source/data transport | Useful built-in approval representation; persistence/recovery requires additional infrastructure | Good composable library; not by itself a complete local durable session owner | Reuse selectively; avoid adding a second competing loop |

Sources: [Pi pinned README](https://github.com/earendil-works/pi/blob/4954d760504c11df9b2cbdc040346107b6a8153d/packages/durable/README.md), [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview), [LangChain human review](https://docs.langchain.com/oss/javascript/langchain/human-in-the-loop), [Goose SessionManager](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/session/session_manager.rs), [Goose mobile architecture](https://goose-docs.ai/blog/2025/12/19/goose-mobile-terminal/), [published GDK](https://github.com/aaif-goose/goose/blob/4811ae25f736fdf0ede847449c060e96645426b5/crates/goose-agent/README.md), [Rig AgentRun](https://github.com/0xPlaygrounds/rig/blob/2d1071e0e0c602f994e9d6cfd8cf5faea6f53650/crates/rig-agent/src/run/mod.rs), [AI SDK tool approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).

LangGraph and LangChain are separate layers: the former owns durable graph execution; the latter supplies provider/agent/tool-review components. A raw graph alone is not a complete chat application with titles, transcript exports, or a proposal editor. Likewise, Goose's full product and its alpha portable crates are different reuse surfaces. Popularity of a parent project is insufficient evidence for a newly extracted kernel.

## What was actually tested

All dependencies were installed into temporary directories with lifecycle scripts disabled. No production dependency, app setting, user vault, provider credential, or live model endpoint was changed.

**Pi published 1.3.0:** browser core and selected-provider bundles built; an actual Chromium fake-model conversation finished with user/assistant entries and no Node globals. A separate Node SQLite test persisted a pending review, gracefully closed/reopened the harness, edited and approved the draft, then resumed the original submission. One simulated effect used the edited text. These are separate proofs: they do not establish a single browser-to-native-storage integration or crash-safe note publication. [Exact experiments and source pins](pi-mobile-source-findings.md#isolated-experiments-actually-run), [retained fixture](pi-probe/README.md).

**LangGraph published 1.5.0:** browser bundling succeeded with core 1.2.18/checkpoint 1.2.0. Standard `interrupt()` failed with `Called interrupt() outside the context of a graph.` The installed browser runtime falls back to a mock async-context provider returning no current configuration. A separate static breakpoint plus explicit state update restored the pending node across page reload and correctly accepted edited content/rejected another request; simulated effect count was one. This does not repair the dynamic-interrupt failure. [Retained locked fixture](langgraph-probe/README.md).

The upstream browser test helper supplies its own minimal ambient context shim. That is evidence of test infrastructure, not proof of safe context isolation for overlapping asynchronous runs. We did not import that shim or build a new async-context implementation to force a pass. Public reports describe related browser approval/context limitations, consistent with our direct result. [Browser entry example](https://github.com/langchain-ai/langgraphjs/blob/main/examples/how-tos/use-in-web-environments.ipynb), [test shim](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/browser.ts), [upstream approval issue](https://github.com/langchain-ai/deepagentsjs/issues/612).

LangGraph's official guidance favors dynamic interrupts for human workflows and discourages static breakpoints for that purpose. Resume re-executes the interrupted node, so effects require appropriate idempotency. Its in-memory saver does not survive restart; production durability requires persistent storage. [Interrupt contract](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence). Our localStorage fixture deliberately serializes MemorySaver internals solely to test reload behavior; it is not the native storage proposal.

No candidate ran inside WKWebView, on an iOS simulator/device, through our Rust SQLite bridge, or against live providers in this investigation. Those remain acceptance work. A standard Node sidecar is not the common mobile path: Tauri's shell plugin limits iOS to opening URLs. Persisted work can resume after app execution returns; it does not grant unlimited background execution. [Tauri platform support](https://tauri.app/plugin/shell/), [Apple background execution](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time).

## Pi extensions: useful, with a specific boundary

The user's extension observation strengthens the composition idea. However, **Pi coding-agent extensions and Pi Durable extensions are different APIs**:

- Existing coding-agent extensions use an `ExtensionAPI` factory, tools/commands, lifecycle events, session methods and terminal/RPC UI. The stock loader imports Node facilities and uses `jiti`. Some pure logic can port; terminal controls and Node tools are not automatically mobile capabilities.
- Durable supplies portable `defineExtension({ tools, sections, hooks, wraps, tasks })` definitions installed into a registry. These participate in its durable tasks/documents. No stock adapter from the coding-agent extension host was found.

Sources: [coding-agent guide](https://github.com/earendil-works/pi/blob/4954d760504c11df9b2cbdc040346107b6a8153d/packages/coding-agent/docs/extensions.md), [loader](https://github.com/earendil-works/pi/blob/4954d760504c11df9b2cbdc040346107b6a8153d/packages/coding-agent/src/core/extensions/loader.ts), [Durable definitions](https://github.com/earendil-works/pi/blob/4954d760504c11df9b2cbdc040346107b6a8153d/packages/durable/src/harness/define.ts).

A bundled **Gneauxghts notes extension** could expose search/read tools, model-facing evidence sections, freshness hooks, proposal documents and review tasks. This places our custom behavior on an upstream durable kernel. Port individual ecosystem extensions when their dependency and API mapping saves work; do not assume installing the terminal extension host will supply durable mobile approvals.

## Combining Pi with Open WebUI evidence

**Yes to combining responsibilities.** One engine can own sessions/tool execution while Gneauxghts note tools issue source records, and the existing Svelte interface presents those records using ideas from Open WebUI. Evidence records should carry stable IDs, Note Identity, current-content hash or immutable Note Revision Identity, captured text/range, originating tool/run identity, and scope/grant bindings. Per-answer citation numbers are aliases, not durable identities.

**Open WebUI is an application reference rather than an established standalone evidence package.** Its source records flow from Python retrieval into chat middleware/storage and app-coupled Svelte components. Importing that stack adds substantial integration without replacing note freshness/identity semantics. Reuse its source/context/presentation separation and compare its inspection UX. AI SDK has cleaner source-document/source-url and typed custom data parts if adopting a library message transport actually reduces code. Neither source cards nor retrieval scores establish claim entailment. [Pinned Open WebUI retrieval](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/retrieval/utils.py), [middleware](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/utils/middleware.py), [citation UI](https://github.com/open-webui/open-webui/blob/v0.11.4/src/lib/components/chat/Messages/Citations.svelte), [AI SDK source/data types](https://github.com/vercel/ai/blob/main/packages/ai/src/ui/ui-messages.ts).

Current Open WebUI has branding conditions, so selective source copying is not equivalent to using an unrestricted component library. Historical `v0.6.5` has verified BSD-style conditions and a citation component, but vendoring requires checking the dependency closure and notices; later fixes do not automatically share that historical license. Independent modeling of the interaction avoids importing its server. [Current inspected license](https://github.com/open-webui/open-webui/blob/v0.11.4/LICENSE), [historical license](https://github.com/open-webui/open-webui/blob/v0.6.5/LICENSE), [full evidence investigation](evidence-source-findings.md).

The desired composition is **one durable execution owner + native note/evidence services + Gneauxghts UI**, with selective library reuse. Running Pi and Open WebUI as competing session/RAG owners would add synchronization work.

## Concrete replacement boundary in this repository

This proposal **contradicts ADR 0001's assignment of durable lifecycle ownership to the app**. Reopening that decision is justified only if a working integration deletes corresponding app machinery. No ADR or runtime ownership has been changed by this research. [ADR 0001](../../docs/adr/0001-keep-agent-runtime-app-owned.md), [architecture](../../ARCHITECTURE.md), [behavior invariants](../../docs/architecture/behavior-invariants.md).

| Existing responsibility | Replacement target | App responsibility that remains |
| --- | --- | --- |
| Generic admission/run state in `chat/admission.rs`, `chat/runtime.rs`, `chat/store.rs` | Engine admits input, runs model/tools, persists lifecycle/checkpoints, projects committed state | Scope/context admission, Tauri event/UI adaptation, session naming/vault association and migration |
| Run-local model/tool coordination and context compaction | Upstream execution/replay/compaction, with app evidence-filter hooks | Provider settings/secure transport; admissible evidence policy and app instructions |
| Durable pending-review storage/coordination in `chat/note_proposals.rs` and review checkpoints | Engine-owned proposal document/task/decision; remove corresponding duplicate custom persistence after acceptance | Note Proposal schema and review rules, editor body/hunk behavior, freshness/conflict checks |
| Approval continuation and rejection | Engine waits/resumes original tool/task after a persisted decision | User authorization and exact accepted payload binding |
| Canonical publication and recovery receipts | Native idempotent commit service called by engine | NoteTimeline remains write authority; reconcile crash after note commit before engine outcome persistence |
| Sources and structured answer association | Engine may store opaque evidence records with the task/answer | `services/evidence.rs`, `chat/citations.rs` and domain validation still issue/admit authentic passages |
| Managed Markdown transcript projection/import/relocation | Adapter projects committed engine history if contract retained | Existing user-visible Markdown recovery and vault-relocation behavior |

These are responsibility-level deletion candidates, not a claim that whole files can be removed. For example, `chat/recovery.rs` covers Markdown transcript recovery; it is not merely restart recovery of running tasks. The editor's `reviewSession.svelte.ts` and review extension own live body/hunk behavior that a generic approval prompt does not implement.

At the time of this investigation, startup marked unfinished requests cancelled rather than automatically continuing them. Introducing replay/resume changes product behavior and needs an explicit policy: restore a pending review, retry only safe tasks, and do not silently authorize a new note mutation. Direct Save-to-Note should remain possible without a model call. Note-grounded assistant prose must still be omitted from later model history/compaction or freshly revalidated according to ADR 0009. Historical source at `64cc3ff6`: `src-tauri/src/chat/store.rs` and `src-tauri/src/chat/note_proposals.rs`; [historical evidence policy](../../docs/adr/0009-allow-scoped-retained-activity-evidence.md). The later rebuild and ADR 0012 supersede this proposal's replay and evidence policy.

The important simplification is allowing upstream state to become authoritative. Rust can implement native SQLite transactions without retaining a second generic run/task state machine. At the publication boundary, keep stable intent IDs and native commit receipts; no inspected engine makes its checkpoint and a Markdown file mutation one atomic transaction automatically.

## Next acceptance experiment

Build one isolated Pi Durable native-bridge vertical slice, with existing Rig AgentRun as the inexpensive comparison baseline. Use a single scope-aware read and a single reviewed note tool inside the existing chat UI. Do not port third-party plugins or replace retrieval simultaneously.

1. Run the published core in actual desktop webview and WKWebView, with Rust SQLite transactions and existing secure provider transport. Verify both current supported protocols and cancellation/network failure behavior.
2. Persist a pending Note Proposal, edit its body/hunks, terminate/relaunch, then Keep or Discard. Verify accepted payload and note preconditions, rejection, duplicate decisions and late refinement.
3. Inject termination before/after tool intent, native commit, native receipt and engine outcome. Confirm no duplicate publication or hidden approval; surface an interrupted unsafe tool appropriately.
4. Verify evidence survives restart, note edits/renames/exclusion invalidate current citations appropriately, retained revisions remain addressable, and old assistant claims never become fresh evidence through compaction.
5. Exercise foreground/background, IPC rollback, storage failure and at least two isolated sessions. Record concrete custom state/code removed, bridge code added and the required ADR changes.

Adopt only if that slice materially reduces owned session/approval machinery and passes iOS behavior gates. If a stable local kernel is required immediately, preserve the current native design and use more of Rig's existing serializable run state while Pi Durable matures. If a backend is acceptable, evaluate LangGraph's supported persisted approval route instead of inventing browser async-context machinery.

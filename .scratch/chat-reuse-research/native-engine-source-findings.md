# Native engine and mobile source findings

Investigated 2026-10-15. Documentation and released source inspection only. No production changes, dependency installation, build, or device acceptance performed.

## Conclusion

**Goose can replace materially more session and permission machinery than a provider SDK when used as the full desktop agent/server. It is not currently a verified local desktop+iOS drop-in. Its new lightweight `goose-agent` crate is a promising portable loop, but leaves session storage and approval orchestration to the embedder.** Calling either of these simply “the Goose SDK” hides the most important distinction.

For an engine executing locally on both desktop and iOS, **the current Rig dependency is the lowest integration-risk baseline**. It already offers a serializable `AgentRun` state machine that Gneauxghts does not have to recreate. That can reduce turn coordination; it does not supply a complete durable conversation and approval product. For maximum deletion of custom session/review coordination, a service architecture with an engine outside the phone remains substantially easier than native local embedding. Remote execution is a product tradeoff, not an interchangeable packaging detail.

## Version pins and inspection scope

- Goose application release checked: [v1.54.0](https://github.com/aaif-goose/goose/releases/tag/v1.54.0), published 2026-10-08. Commit `cd643d2126fffab4c6a6186905211ba868d6a657`. Source snapshots below use this immutable pin.
- Latest published GDK packages checked independently through the public crates.io API: [`goose-agent 0.1.0-alpha.12`](https://crates.io/crates/goose-agent/0.1.0-alpha.12) and [`goose-sdk 0.1.0-alpha.12`](https://crates.io/crates/goose-sdk/0.1.0-alpha.12), published 2026-10-13. Their published `.cargo_vcs_info.json` identifies commit `4811ae25f736fdf0ede847449c060e96645426b5`. The application v1.54.0 tree still has GDK alpha.11 manifests; these are separately versioned releases.
- Gneauxghts pins `rig-core` and `rig-agent` 0.44.0 in `src-tauri/Cargo.toml`. The locally installed published crate identifies commit `2d1071e0e0c602f994e9d6cfd8cf5faea6f53650`. Public registry publication date: 2026-10-07. [Rig agent package](https://crates.io/crates/rig-agent/0.44.0).
- Public source was downloaded to `/private/tmp/gneauxghts-goose-research` for targeted inspection. Live `main` was initially consulted, then conclusions were checked against the released application and published GDK. No claim below relies on unmerged feature proposals.

## Three different Goose surfaces

| Surface | What it actually provides | What it does not establish |
| --- | --- | --- |
| `goose-sdk` with `uniffi` | In-process provider calls, streaming/tool-call chunks, compaction, provider request logs, Rust/Python/Kotlin bindings | Full agent/session/approval persistence API |
| `goose-agent` | Re-entrant ordered operation machine, inference/tool helpers, cancellation and emitted events; host supplies persisted session/effect traits | Supplied SQLite session owner, complete approval policy, replay-safe external-effect transactions |
| Full `goose` crate / ACP server | Agent, SQLite SessionManager, permission inspections, durable confirmation messages, pending confirmation recovery, extensions and compaction | Supported on-device iOS embedding; a clean public library surface for each concrete approval operation |

The [official SDK overview](https://goose-docs.ai/docs/gdk/sdk/) explicitly describes the provider layer and labels the SDK alpha. Published [SDK lib.rs](https://github.com/aaif-goose/goose/blob/4811ae25f736fdf0ede847449c060e96645426b5/crates/goose-sdk/src/lib.rs) exposes shared wire types and optional provider bindings, not the complete Goose Agent. Provider compatibility can replace some Gneauxghts provider handling, but moving from Rig to this surface alone does not address the user's session/approval concern.

The published [goose-agent README](https://github.com/aaif-goose/goose/blob/4811ae25f736fdf0ede847449c060e96645426b5/crates/goose-agent/README.md) describes a state machine assembled by the caller. `SessionLoader`, `EffectHandler`, and `MachineSession` are implemented by the host. It reloads session state between passes. Consequently persisted history can determine the next step, but the embedder still owns storage, persistence ordering, and domain operations. Its [manifest](https://github.com/aaif-goose/goose/blob/4811ae25f736fdf0ede847449c060e96645426b5/crates/goose-agent/Cargo.toml) identifies alpha.12 and Rust 1.94.1. **This is reusable orchestration infrastructure rather than an already complete replacement for ChatService.**

## Full Goose: sessions and approvals are real, with limits

[SessionManager source](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/session/session_manager.rs) includes session create/load/list/delete/export/import, messages, metadata and compaction storage. Its SQLite connection uses WAL, foreign keys and busy timeout. This is substantially more than “keep a Vec of messages.” Gneauxghts could theoretically adopt this owner and expose projections through Tauri, eliminating corresponding generic session CRUD/storage. Migration of existing sessions and mappings to vault context remain work.

The [state-machine persistence adapter](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/agents/state_machine/session.rs) persists confirmation requests before emitting them. [Confirmation storage](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/agents/state_machine/tool_confirmation.rs) reconstructs pending requests from history and saves decisions; repeating the same persisted decision succeeds and a conflicting decision fails. [Agent recovery](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/agents/agent.rs) has a `resume_state_machine_turn_inner` path for pending confirmations or unapplied persisted confirmation responses. The state-machine path is gated by `GOOSE_STATE_MACHINE`; callers/server configuration matter. These are genuine durable approval features.

The [concrete approval operation](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/agents/state_machine/ops_tool_approval.rs) stores permission responses and executable metadata. The decision is `Permission` (allow/deny/cancel, including remembered policy), rather than an edited replacement argument payload. This inspected approval API therefore does not directly replace editable reviewed Note Proposals. A custom review tool or operation can resolve a proposal ID and retrieve the approved body from the app, but that domain bridge must be designed explicitly.

**Saved approval does not mean arbitrary tool effects resume exactly once.** [Full tool executor](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/agents/state_machine/ops_toolcalling.rs) dispatches tool calls and later returns message effects for persistence. When a pending request with approval history has no retained extension lease, it responds that the approval expired and the tool must be requested again. This protects against applying old permission to a changed tool environment, but means recovery does not simply continue every previously approved call. Do not treat SQLite transcript persistence as an atomic transaction with external note writes.

Similarly, lightweight [ToolOperation](https://github.com/aaif-goose/goose/blob/4811ae25f736fdf0ede847449c060e96645426b5/crates/goose-agent/src/tool.rs) calls tools before returning response effects. An external effect can complete and the process can die before its result is durably recorded. I did not find a Pi-like per-tool replay policy exposed in this primitive. Host-controlled idempotency/outcome reconciliation is still required for canonical note publication. This observation is about the inspected surface, not proof no Goose extension can implement such a policy.

Goose's actual concrete operations remain internal to the full crate assembly: [state-machine exports](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/src/agents/state_machine/mod.rs) re-export generic loop traits but mark `ToolApprovalOperation` and `ToolExecutionOperation` `pub(super)`. Selective reuse of the full approval implementation is therefore a maintained extraction/fork or an upstream API request, not merely importing a documented public approval component.

## Desktop and iOS: local embedding versus remote access

Goose **does have an official iOS application**, but it connects to a desktop Goose instance through a tunnel. The [first-party mobile announcement](https://goose-docs.ai/blog/2025/12/19/goose-mobile-terminal/) and [mobile client roadmap](https://goose-docs.ai/blog/2026/01/20/goose-mobile-apps/) explicitly describe this client/remote-agent architecture. That establishes mobile access, not an on-device Goose engine.

Full [Goose Cargo.toml](https://github.com/aaif-goose/goose/blob/cd643d2126fffab4c6a6186905211ba868d6a657/crates/goose/Cargo.toml) still includes unconditional desktop-oriented dependencies such as arboard, sys-info, Tokio process/signal/std-I/O capabilities and MCP child-process transports. Optional feature removal helps some areas, but does not make this a verified iOS library. No iOS build/test target was located in the application release tree. Actual cross-compilation and simulator/device execution would be required before claiming feasibility. Do not infer iOS support merely because the agent is written in Rust.

`goose-agent` is much more portable. Its [merged WASM work](https://github.com/aaif-goose/goose/pull/12569) and published README describe `wasm32-unknown-unknown` builds and tests with synchronous/asynchronous tools and retries. That supports a potential native Rust or webview-WASM experiment without a Node process. It does not provide a mobile SQLite approval/session implementation; writing that adapter can erase much of the desired savings. A successful WASM test is also not an iOS background/restart acceptance test.

The GDK docs advertise Rust, Python and Kotlin, and packaged Kotlin native libraries for macOS/Linux/Windows. Swift/iOS is not a documented SDK binding/distribution target on the inspected page. Gneauxghts can call Rust through Tauri, so absence of Swift bindings alone is not a blocker; it is simply not affirmative mobile support.

## Rig is a more capable baseline than “provider loop only”

The pinned [rig-agent run module](https://github.com/0xPlaygrounds/rig/blob/2d1071e0e0c602f994e9d6cfd8cf5faea6f53650/crates/rig-agent/src/run/mod.rs) defines a serializable sans-I/O `AgentRun`, `AgentRunStep::{CallModel,CallTools,Done}`, pending tool calls, turn assembly and history handling. Its documentation explicitly says drivers supply responses/tools and lifecycle policy; runs own no models, memory backends or hooks. Persisting this object at well-defined boundaries can reduce custom turn state logic while retaining current provider integration. It does not automatically supply a durable session database or human approval owner.

This is already a dependency in the repository, so it avoids importing another complete desktop application or changing the iOS execution architecture. Its [runtime README](https://github.com/0xPlaygrounds/rig/blob/2d1071e0e0c602f994e9d6cfd8cf5faea6f53650/README.md) also documents portable core/classic-runtime WASM support and recording/replay infrastructure. Recording/replay should not be equated with a production approval/workflow database. The repository's existing native/iOS build must still be used to establish acceptance.

## Native comparison and experiment priority

| Candidate | Potential generic deletion | Local desktop+iOS evidence | Recommendation |
| --- | --- | --- | --- |
| Full Goose Agent + SessionManager | Largest among inspected Rust surfaces: session CRUD/SQLite/messages/compaction/confirmation state | Desktop product; official iOS is a remote client; local embedding unverified and dependency extraction needed | Strong if desktop/remote execution is acceptable; poor first bet for guaranteed local parity |
| Published goose-agent alpha.12 | Loop/inference/tool dispatch/cancellation predicates and event vocabulary | WASM build/tests; no established iOS session/review owner | Small feasibility comparison only; do not sell as durable sessions already supplied |
| Current Rig AgentRun 0.44.0 | Serializable model/tool turn state, streaming assembly/recovery vocabulary | Already integrated dependency; durable store is still ours | Best low-cost native baseline for the comparison; less deletion than full service engines |

I did not identify a more established Rust-native engine with a documented embeddable SQLite conversation store, editable durable approvals, replay policy, and supported local iOS execution in this focused comparison. This is a scoped research result, not an exhaustive proof of absence. Novel durable workflow crates are not a strong answer to the user's preference for widely maintained battle-tested foundations without their own adoption and mobile acceptance investigation.

A useful bounded experiment is **Rig AgentRun versus goose-agent**, with the same current model/provider and a single reviewed note tool. Require persisted pending review, edited approved content, concurrent note changes, cancellation, app kill/restart before and after commit, and physical iOS execution. List exact current code removed and new adapters added. If neither deletes session/review machinery, stop treating native engine swapping as the path to the larger savings and evaluate the service alternative consciously.

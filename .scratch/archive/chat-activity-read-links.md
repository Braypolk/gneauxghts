# Named note and passage links in chat Activity

Implemented 2026-10-14.

Activity expands each delivered read into clickable note names with bounded
passage previews. Current passages use the existing exact-selection navigation;
historical passages use the retained content revision. Editing reads link to the
note. Reads remain visible even when not cited in the final answer, and do not
become answer sources or model-history context.

`agent_runtime.rs` attaches only app-admitted destinations to successful
`ToolCallUpdated` outcomes. `agent_tools/evidence.rs` resolves issued source IDs
against validated reads; discovery previews, failed reads and invented IDs are
inert. Research activity includes only evidence actually delivered to the parent.
Draft/chat preparation reads do not masquerade as canonical note reads.

The optional source field replays through the existing event store without a
schema migration. Conversation loading and passage navigation enforce the same
access/exclusion/freshness rules as answer citations. Old count-only events are
not backfilled from final answer sources. Source normalization is shared between
Activity and answer citations; no new model call, prompt text or tool is added.

Current ownership is recorded in [ARCHITECTURE](../../ARCHITECTURE.md) and the
[behavior invariants](../../docs/architecture/behavior-invariants.md).

## Validation

- Frontend: 153 files / 1,232 tests passed; 33 support tests passed.
- Svelte and E2E TypeScript: no errors or warnings.
- Architecture: 21 checks and one runtime lifetime check passed.
- Rust: broad run passed 912 tests and exposed one outdated error-message
  assertion from the freshness fix. After updating that assertion, its focused
  recheck passed; 31 opt-in tests remain ignored.
- Rust coverage includes real runtime read outcomes, issued/unissued references,
  durable event replay after reopening, separation from final answer citations,
  exclusion/access revocation and source changes.
- The frontend reducer regression failed before implementation and passed after
  it; rendered Activity coverage verifies named links and escaped previews.
- Native macOS WebKit: all six chat-to-note journeys passed, including durable
  read metadata, expanding Activity, the named note and excerpt, and clicking
  through to the canonical note. The test checks the destination editor even
  when chat retains focus. Earlier combined runs exposed setup/assertion errors
  in the new test and an intermittent review-switching timeout; the final
  combined run passed in 13 seconds.
- Native binary SHA-256:
  `b6a11c39099af23e955c68e32c0153778cf7c372cad95fa06f5fe91a933b2930`.

No provider inference or real-vault writes were used. Native coverage uses the
disposable macOS WebKit fixture; physical iOS behavior remains unverified.

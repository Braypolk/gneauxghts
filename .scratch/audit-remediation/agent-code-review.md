# Independent agent-seam correctness review

Scope: private chat/admission.rs, chat/store.rs, chat/runtime.rs, services/evidence/inventory.rs, plus concrete command/permission/search callers and added lifecycle/inventory tests. Baseline cb4d4c02f0e2c1220d37b281ee300eff1aabf20b including untracked extracted modules. Intent: agent.md CHAT01/04/05 and EVIDENCE01/02; architecture durable acceptance, terminality, permission identity and current-evidence contracts. This pass supplements the independent Standards report.

## P1 (resolved by 65b): Retry of an older turn can switch the user question on its next retry

Confirmed call path: commands/chat_commands.rs:1153 selects the nearest preceding user message by ordinal. chat/admission.rs:99 accepts any user whose ordinal precedes the selected failed assistant; it separately reads selected context from that assistant's persisted run. chat.rs:1889 retry_run_context does not return/check the run's user_message_id.

Reachable sequence: U1,A1(failed),U2,A2; retry historical A1 appends A3 with durable user_message_id=U1. If A3 fails, retrying A3 selects U2 as its nearest preceding user, but inherits A3's U1 active-note/selected-context record. The request therefore answers the wrong question with context from another turn. No malformed external IPC is needed. This existed before extraction, but the new actual-retry lifecycle test only covers a single user and cannot detect it; it is a concrete gap in CHAT01's retry contract audit.

Recommendation sent to root and backend-agent owner: resolve original user from durable chat_agent_runs linkage, validate conversation/role and the pair within admission, and use that same user for attachment capability validation. Add a two-turn historical retry then retry-of-retry regression proving original user/context/attachments remain linked; keep current valid retry and missing-context failures. Reviewer has made no source changes. Owner correction/verification pending at report creation.

## Inspected invariants without further confirmed defects

- Admission now uses an immediate SQLite transaction across user/attachments/title/assistant/run/context and commits before projection. Trigger rollback tests cover attachments/context and retained title. A post-commit failing projection does not reject accepted send.
- Terminal store matches run and assistant, updates receipt/stats/message/sources in one transaction. Source insertion failure rolls all back; fallback retains durable partial and marks failed when DB remains usable. Runtime emits no success/source events after failed terminal persistence, and missing DB remains startup recoverable. Existing lifecycle test covers actual retry after source failure and reopen.
- All connections use the foreign-key helper; reviewed cascades and startup reconciliation. Streaming reuses a connection while each write remains independent. The existing behavior of ignoring individual checkpoint errors was retained; no new failure caused by connection reuse established here.
- Permission broker finish_run executes before terminal events, removes only that run's grants, cancels pending waiters, and event identity matches the run. Broker identity comparison and cancellation logic inspected; no new cross-run approval path found.
- Inventory cursors reference retained search keys; search_inner recomputes scope/canonical fingerprint and normalized request binding, validates retained citation proofs, and permits continuation at search-count capacity. Immutable grouped witnesses are revalidated before delivery. Offset bounds, byte-limited progress, oversized-row advancement, cancellation and conservative coverage flags remain explicit. Real same-session exclusion/history-clear tests and retained-search-count assertion inspected. No new continuation bypass confirmed.

## Limits and readiness

Read-only correctness review; no full tests launched because root is running combined Rust/native/browser validation. Reviewed actual source/test paths, not inferred pass status. Retry lineage finding is closed by the follow-up review below. Other inspected paths have no additional confirmed blocker from this pass.

## 65b correction re-review

Reviewed the completed correction read-only after the owner reported chat59 passed /1 measurement ignored. Command chat_retry_message resolves the original user through ChatService.retry_user_message_id, and attachment capability validation uses that same user's attachments. retry_run_context includes user_message_id from the selected durable run; admission rejects a mismatched pair before opening the transaction. It still checks role/conversation/order, and the in-transaction lookup protects disappearance of the user. Missing legacy run context retains its previous fail-closed behavior.

Checkpoint branch additionally maps original user and retry-of assistant identities through its source-to-copy message map. It copies the exact selected run's context, force-web flag and active-note JSON, including runs with empty context/events. This prevents branching from reintroducing transcript-order lineage. The new regression covers U1/A1 failure, U2/A2 completion, historical retry, rejection of the former wrong U2 pairing without writes, repeat retry using U1, then branch and retry of the copied failed turn. Separate coverage rejects missing run context. Source review confirms those assertions exercise the production admission/resolution path.

**Closure:** the demonstrated original-user/context mismatch is corrected, with no remaining concrete blocker found in this bounded follow-up. No production changes or additional suites run by this reviewer; owner focused results above and root combined/native validation remain separately attributed.

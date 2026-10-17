# Pi native-call and storage attribution — 2026-10-16

> Historical evaluation findings, superseded as an implementation plan by the [completed rebuild](../archive/pi-chat-rebuild.md).

The large call count has two demonstrated causes: the prototype exposes individual SQLite operations across the native bridge, and the adapter repeatedly reconstructs full conversations. The reported 3× storage footprint was primarily retained WAL, although duplicated request history is a separate, real growth problem. This investigation changes no product code and does not establish a production performance verdict.

## Evidence and scope

- Historical comparison: v38 shared-resource fixture, four identical bounded journeys per lane, generated isolated data. The [historical outcome](../archive/pi-durable-chat-evaluation/outcome.md#costs-and-scale) records the aggregate comparison. The three-run aggregate remains `/private/tmp/pi-v38-controlled-resource-summary-20261016.json`.
- Evaluation-code attribution: the historical call probe, results and source digests were consolidated into the findings below; redundant raw files were pruned. Uses installed pi-durable 1.3.0, actual ChatApi, Pi harness, SqliteStorage, nativeSqlite facade and provider parser. Replaces the native boundary with real Node SQLite and synthetic domain/HTTP responses. Twenty sequential source-free short turns, one provider response each, correlated completion events, no full-conversation polling during a turn. Transcript publication remains active. Explicit read phases follow turns 1, 5, 10 and 20; eight extra reads follow turn 20.
- Storage attribution: a historical copy-only probe, summarized below. Verifies archived file sizes against the receipt, copies the lifecycle database and companions, checks integrity, checkpoints only the copies, and verifies source database hashes are unchanged.

The current probe measures operations and JSON proxy bytes, **not native IPC timing, disk allocation, local-model performance, lease behavior, or a current old-runtime comparison**. Fixture mode disables capacity probing; this is a before-compaction history-growth experiment. Current uncommitted chat refinements are included. Archived stores were not in use; the running evaluation app and original vault were untouched.

## 1. Most observed calls are fine-grained SQL bridge operations

Historical run 1: Pi made 1,098 observed module invokes versus 26 for the old lane. Of Pi's calls, 988 (90%) were SQL. The repeated runs recorded 1,085 versus 26, approximately 41.7×.

The boundary is asymmetric. Old chat commands execute their SQL inside Rust; those statements do not appear as separate module invokes. Pi's TypeScript storage implementation sends each get/all/run/exec/begin/commit through `pi_sql`. The call ratio therefore describes actual bridge traffic, not total SQL work, inference count, or a 42× CPU cost. Historical provider accounting was one request per journey in both lanes.

The current no-polling probe still records 182 calls on turn 2 and 200 on turn 20, including 168 and 186 SQL calls respectively. Turn 20 contains 131 SQL reads, 39 write/exec calls and 16 begin/commit calls: eight durable transactions. Startup separately costs 125 invokes, mostly initialization/migrations.

Mechanism: the retired `src/lib/prototypes/pi/nativeSqlite.ts` adapter queues statements and invokes native separately for each. Upstream SqliteStorage.commit also reads allocation metadata, checks global IDs and document addresses, writes records/revisions and updates metadata. These are useful consistency operations, but the adapter gives every statement a bridge round trip. The native handler prepares individual statements and serializes their results.

## 2. Full-history projection and uncached misses add avoidable reads

| Current warm operation | Invokes | SQL invokes | Result JSON bytes |
| --- | ---: | ---: | ---: |
| Read after 1 turn | 13 | 11 | 20,716 |
| Read after 5 turns | 17 | 15 | 46,652 |
| Read after 10 turns | 22 | 20 | 104,542 |
| Read after 20 turns | 32 | 30 | 305,286 |
| Eight reads after 20 turns | 256 | 240 | 2,442,288 |

At 20 turns, 21 of the 30 SQL reads return missing optional documents: 20 per-origin summary-usage documents and the absent review catalog. Existing documents can hit the Pi session cache; missing documents are not cached by Session.#loadDocument. These missing reads repeat even when nothing changed.

The same read fetches all entries twice: once for getConversation and once again for summary. Those two queries alone return 298,386 bytes. The terminal completion path awaits getConversation, while the separately scheduled Markdown transcript publisher also loads entries/submissions. During turn 20, four ascending full-entry scans return 584,357 bytes; additional reverse/range entry reads increase this further. The complete turn returns 800,289 JSON proxy bytes despite a short synthetic answer.

This is an adapter projection problem as well as a storage-boundary problem. Current getConversation visits every historical input, performs per-origin snapshots and repeated array searches, then summary rescans submissions/entries. loadTranscript independently rebuilds a full snapshot. See `chatApi.ts` getConversation, summary, loadTranscript and submit's terminal handler.

## 3. The historical fixture amplified that cost

The shared-resource driver polls getConversation for admission, first visible text and terminal settlement at a 50 ms interval, in addition to before/after reads. Its own receipt explicitly acknowledges observer contribution to IPC and latency. Normal chat uses streamed events and the supplied terminal payload; it does not perform those repeated fixture reads.

The eight-read phase above isolates the amplification without any inference or durable writes. Thus the historical ratio is a valid count for that instrumented journey, but cannot be presented as the ordinary UI's per-turn ratio. The current no-polling result also shows that polling is not the sole cause.

## 4. Nearly all the historical storage excess was WAL

Historical logical file sizes, identical across the three controlled runs:

| File kind | Pi bytes | Old bytes |
| --- | ---: | ---: |
| SQLite main files | 663,552 | 671,744 |
| WAL | 1,351,392 | 0 |
| SHM | 32,768 | 0 |
| Markdown | 9,884 | 10,301 |
| Other | 2,333 | 2,333 |
| Total | 2,059,929 | 684,378 |

The WAL accounts for approximately 98% of the excess bytes. A WAL holds changed database pages, including older page versions; it is not all additional live application data.

On private copies, explicit TRUNCATE checkpointing reduces Pi's lifecycle database group from 1,502,944 to 217,088 bytes, including a 184,320-byte main database and 32,768-byte SHM. Old's main remains 204,800 bytes, with a 32,768-byte SHM created by the same inspection. Replacing only those groups in the captured root totals yields 774,073 versus 717,146 bytes, approximately **1.08×**, rather than 3.01×. This normalization is an offline experiment, not a newly measured normal-exit footprint.

The fixture ends with process SIGTERM and records process closure, not successful application quiescence/checkpointing; its checkpoint state is explicitly unknown. It also performs an earlier SIGKILL/restart. Current normal app shutdown has an explicit checkpoint in PiDatabase.finish_restart_shutdown, reached through application lifecycle settlement. The receipt does not prove that path ran. The retained WAL is established; a defect in normal app checkpointing is **not** established. A follow-up comparison must capture equal, verified checkpoint conditions.

## 5. Request history is a separate storage and transfer multiplier

Each `gneauxghts.request` entry embeds the full history frozen for that request, alongside the normal conversation entries. That preserves exact Retry inputs, but repeats old messages in each later request.

In the current short-turn probe, the 20 request records retain 93,121 bytes of history in total. The final request's history is only 9,311 bytes (38 messages). Before compaction, constant-size turns therefore produce approximately quadratic cumulative history storage. There is no recursive embedding of previous snapshots; this is repeated ordinary message history. Whole-record scans transfer those retained histories again, multiplying read bytes too.

The 20-turn database has 41 entries, 48 documents, 87 document revisions, 20 tasks and 20 submissions. Generic durable bookkeeping contributes, but history duplication is directly measured and cannot be explained away as WAL. After explicit checkpoint, this synthetic Pi database's main file is 335,872 bytes. No matching old 20-turn experiment was performed.

## Recommended order of work

1. Correct the comparison conditions: event-driven observation, equal verified application shutdown/checkpoint state, separate SQL statement counts from bridge-call counts, and report live data separately from WAL/SHM. Retain a polling-stress measurement as a separate case.
2. Reduce projection work: reuse one operation's loaded entries/submissions for its summary, use local maps instead of repeated array searches, and share/coalesce transcript reconstruction where semantics allow. Preserve settlement reconciliation, policy freshness and exact Activity/usage.
3. Avoid repeated optional-document misses with correctly invalidated negative caching or a bulk lookup path. A warm read has 21 demonstrated candidates at 20 turns; caching must not hide documents created by later commits.
4. Move safe batches of SQLite work across the bridge together, preserving native owner revocation, transaction leases, rollback and atomic commits. This targets the dominant bridge category without deleting durability checks.
5. Deduplicate frozen request history through immutable references/content storage while preserving exact Retry and evidence scope. Dropping history or weakening Retry is not an equivalent fix.

No fix or speedup is claimed. The strongest next implementation targets are projection/miss reduction for growing chats and SQL batching for fixed per-turn bridge overhead. The old 3× storage headline should be qualified immediately as a retained-WAL result.

## Historical reproduction

These probes targeted the retired evaluation composition. Their results are not
current ordinary-chat measurements, and their commands are no longer maintained.
A new comparison must use current product paths and matched checkpoint/observation
conditions. The superseded portable-overhead backlog was never implemented as
written; the new-user rebuild dropped exact Retry/migration and adopted Pi's
standard compaction. No permanent numerical budget or performance win follows.

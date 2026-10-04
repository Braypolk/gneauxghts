# Simplify production architecture

User authorization: a rewrite is acceptable where it reduces complexity and improves the application. The previous test reduction did not satisfy the desired architectural improvement.

Audit and compare concrete replacement designs before source changes. Preserve existing user behavior, canonical durable data and documented invariants. Favor fewer independently coordinated states, fewer dependencies/ordering rules at call sites, and one clear owner per operation. File extraction, renamed wrappers and net LOC alone do not satisfy this task. Delete superseded implementations and their obsolete tests; exercise replacement behavior through the real application boundary. Keep unique regression protection.

Current working-tree baseline is recorded in baseline.json independently of Git HEAD, which includes earlier work. Five delegated read-only audits cover documents/workspace, an independent frontend alternative, timeline persistence, agent/chat/semantic backend, and frontend UI state. Coordinator reviews proposals, selects coherent rewrites, records decisions/issues before implementation, and assigns non-overlapping ownership. Verification and review must address invariant preservation and actual reduction in caller burden.

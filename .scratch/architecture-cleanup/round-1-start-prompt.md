# Fresh-context implementation prompt

Copy the text below into a fresh task. This prompt authorizes only the narrowed first round.

```text
Work in /Users/bray.polkinghorne/Documents/code/personal/Gneauxghts. Implement only Round 1 of /Users/bray.polkinghorne/Documents/code/personal/Gneauxghts/.scratch/architecture-cleanup/spec.md.

The authorized order is 01 → 02 → 14 → 03 → 09 → 10: remove inert interfaces; collapse duplicate projection/warning representations; organize NoteTimeline into cohesive private implementation/test files (14); establish one semantic pause authority; centralize committed-document adoption; replace path-based resource identity with stable open-document handles. Stop after ticket 10 and the final audit. Tickets 04–08 and 11–13 are deferred, not prerequisites. Do not resume deferred note-history issues or the historical scale/native acceptance effort.

You are the orchestrator, not the production implementor. Start one fresh-context subagent per ticket, sequentially (use fork_turns="none"). Give each agent the repository path, spec, exact ticket, relevant investigation, current baseline and necessary constraints. Audit its full changed workflow and resolve follow-ups before starting the next ticket. Keep implementation follow-ups with that ticket's agent.

First read AGENTS.md, the spec, relevant architecture/invariant/ADR documents and the repository codebase-design skill. Inspect current source and ticket resolutions: this is a dirty shared workspace, and the original source line references may have moved. Preserve unrelated changes and establish a per-ticket baseline; do not measure against HEAD as though all existing changes were yours.

Ticket 14 executes immediately after 02 and is organization only. Preserve the existing NoteTimeline owner, caller import paths, capability privacy, behavior, lock ordering and test coverage. Move cohesive implementations and tests into private files; do not add services, traits, forwarding layers or deferred publication redesign. Update file-sensitive architecture checks and later source pointers. Report moved lines separately from genuine deletions; parent-file shrinkage is not code removal.

Work backward from required behavior and the smallest useful operation. Remove the replaced fields, callbacks, transfer protocols and obsolete helpers as callers migrate. Do not add generic frameworks, parallel owners, speculative adapters or duplicate test layers. Ticket 09 must use existing backend contracts; it does not require publication-admission, proposal-command or review-state redesign.

Preserve newer edits, saved baselines, committed-warning/no-resubmission semantics, exact restore behavior, shared undo, collision handling and real pause/wake behavior. Run appropriate existing behavior and contract checks; replace obsolete wiring tests with meaningful boundary coverage. Use isolated fixtures for any necessary native validation, never the user's databases.

After each ticket, record production/test added/deleted/net lines separately, removed interfaces/state/coordination, validation and audit follow-ups. Continue autonomously within this scope. If deferred architecture work is truly required, explain the concrete dependency before expanding scope.

Finish with before/after save, restore-adoption and rename workflows using the plan's counting method, total code/test deltas, remaining risks, and a candid assessment of whether caller obligations actually decreased. Then stop; do not automatically implement the deferred backlog.
```

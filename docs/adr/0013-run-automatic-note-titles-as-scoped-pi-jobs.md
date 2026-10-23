---
status: retired at user request on 2026-10-22
---

# Run automatic note titles as scoped Pi jobs

## Retirement

On 2026-10-22 the user explicitly requested scrapping automatic AI titles. The
setting, editor controller/preview, scoped Pi task, native title authority and
transport commands, and extractive semantic fallback are removed. Ordinary
first-line filename derivation is restored for captures without an explicit title.
Existing files are not bulk-renamed. Read support for temporary blank-title captures
and hiding old internal title-job conversations prevent data/presentation regressions;
old persisted title preferences are inert and no longer read. Explicit Pi filename
editing remains governed by ADR 0015.

The original decision below is historical, not an active implementation contract.

The user chose automatic titles for new captures whose title they have not edited,
with an explicit opt-in. Run these jobs on the existing Pi Harness in a dedicated
application-job conversation identified by purpose and excluded from human chat
navigation. Installed Pi tasks require a conversation; this explicit scope keeps
Pi task scheduling and cancellation without adding an application generation
controller or silently using an ordinary chat's history or authority.

Native title authority is separate from chat read/write grants. The Running Vault
preference defaults off. A short-lived native lease binds one visible saved Note
Identity, canonical path and exact bytes, its current title, a provider-session
identity and the configured provider/model. Caller title and editor Markdown must
match that saved note. Global note exclusions win. Native code constructs the
entire provider transcript from fixed title instructions and at most 12,000 Unicode
characters of saved body; it does not forward caller messages, tools, properties,
attachments, other notes or chat context. Dispatch, streamed delivery and terminal
delivery recheck permission, exclusion and the canonical source. Disabling the
preference withdraws leases and cancels their requests.

The Pi task receives only opaque job/session references and provider/model names.
It has no tools, note grants, submissions or transcript entries. Terminal task
records retain a bounded title result and references, not note excerpts. The native
lease holds the excerpt only in memory, is released after settlement and expires
after two minutes. Tasks are abandoned after process restart because their
frontend title-intent guard does not survive; recoverable note capture remains
independent. The installed public Pi API has no task/conversation deletion method,
so this slice does not manipulate its storage to prune terminal records.

Title inference cannot publish a file or rename. Ordinary untitled captures use
an identity-bound temporary filename (`Untitled Note <Note Identity>.md`) and a
managed `untitled` marker. Session reads expose an empty title only while both
agree; an explicit filesystem or Pi rename supplies an ordinary title immediately.
The first body line no longer becomes the editor title. Existing named notes are
unchanged. A later accepted or typed title uses ordinary save/rename ownership.

The editor schedules untitled captures after at least 80 Unicode characters of
saved body. Suggestions remain ephemeral and display Accept/Reject controls;
after ten seconds without edits the editor applies the suggestion through ordinary
document title/save ownership. Body edits withdraw stale suggestions. User title
input wins even if cleared; rejection and typing intent are remembered by Note
Identity in the title preference store so reopening cannot revive them. Failures
to remember rejection are visible without failing the note save. Opt-in is checked
again on acceptance. Blocked editors defer automatic application.

The task tries the default AI provider first with a thirty-second deadline. Local
models advertising an off/none reasoning choice use it for this bounded one-line
request, independently of chat preferences. On failure or unusable output, the
same task asks the native lease owner for an extractive semantic fallback.
EmbeddingGemma ranks at most 24 short phrases from this saved note against the
bounded note body; it cannot generate text. The semantic module retains runtime
and work-queue ownership. This inference reads no corpus vectors and does not
require index reconciliation to finish. Permission, source and lease membership
are checked again before delivering it. Cancellation withdraws native authority
immediately. If neither model can supply a suggestion, the saved note stays
untitled. Mandatory Note Timeline preparation remains intact.

This narrowly amends ADR 0012's absence of background title inference and the
corresponding architecture statement. It introduces no generic filesystem
executor, automatic chat-note promotion, or background research inference.
Pi filename renaming is separately governed by [ADR 0015](0015-prove-agent-renames-across-both-locations.md),
with its own operation grant, exact destination review, no-clobber move proof and
editor adoption contract; it does not follow from this inference decision.

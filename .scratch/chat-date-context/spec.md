# Chat understands authored dates and task deadlines

Connect the editor date/time feature from `0466937` to ordinary chat and bounded
research without adding a workflow router, date presets, automatic scheduling or
direct-write authority.

- Capture current Intl locale, numeric date order, hour cycle and IANA timezone
  on sends and retries. Treat these as turn-local configuration, never authoring
  provenance for older/imported text. Legacy callers can omit the context.
- Use that timezone for the run reference and relative calendar interpretation;
  explicit tool date ranges remain independently configurable.
- Teach parent and worker the same distinction between fixed date/time text,
  calendar-only `@due` deadlines and recorded activity. Preserve ambiguous dates,
  wall-clock/DST semantics, per-child deadlines and completed-task status.
- Read canonical deadline metadata through the existing evidence capability,
  using the existing Markdown/annotation parsers. Metadata describes only
  delivered complete checkbox lines, with bounded items and explicit omissions;
  history requires a fresh current read. It uses the same access, freshness,
  citation and payload-budget checks.
- Date/deadline edits compose working-note reads and reviewed exact proposals.
  No new task mutation route, reminders, due times or persistence schema.

Verify actual API payloads, regional formats, strict optional backend context,
canonical reads, ignored examples/invalid dates, nested tasks, scope/freshness,
bounded delivery, worker context and reviewed deadline edits. Record executed
checks and live-model limits separately.

# Responsive capture tools

The completed work and its verification limits are summarized in the
[historical record](../archive/responsive-screens.md). All 23
recorded issues received implementations. Superseded screenshots, measurements,
old tickets and intermediate audit narrative were pruned on October 10, 2026.

Permanent regressions live in `e2e/specs/browser/responsive-layout.spec.ts`,
`responsive-pane-rail.spec.ts` and `task-group-reorder.spec.ts`.

The follow-up [code cleanup review](../archive/responsive-cleanup-2026-10-10.md)
records the architecture audit, task-ordering race correction and verification.

Optional scripts in `captures/` regenerate local evidence outside the routine
browser suite:

- `audit.spec.ts`: main tabs and Settings at five viewport sizes.
- `initial-rail.spec.ts`: compact split entrance.
- `rail-close.spec.ts`: closing from both sides at phone and medium widths.
- `rail-blur.spec.ts`: scrolled header blur and overflow clipping.

Run a script explicitly from the repository root:

```sh
pnpm exec wdio run e2e/wdio.browser.conf.ts --spec .scratch/responsive-screens/captures/rail-close.spec.ts
```

Generated output goes under the ignored `evidence/` directory. It reflects the
current code at capture time, rather than preserving an obsolete approved layout.

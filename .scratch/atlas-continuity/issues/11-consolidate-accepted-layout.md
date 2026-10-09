# Consolidate accepted map layout

Status: ready-for-human
Type: task

## Evidence and design — 2026-10-08

Independent Standards and Spec reviews confirmed that group-level `changed` flags
still allowed a harmless filename change, deletion, or promotion to translate an
entire root when conservative enclosing circles overlapped. Isolated filename
changes bypassed that handling. Existing sequence tests also omitted initial
layout and core selection performed by production.

The accepted-layout calculation now has one caller-facing operation shared by
publication and sequence tests. It owns initialization, incremental placement,
core selection, metadata assembly, and organic contours. Publication retains
reconciliation, supersession/admission checks and all persistence effects.

Ordinary updates restore accepted positions by Note Identity, then treat
unchanged or smaller footprints as fixed obstacles. New, larger, or deliberately
reassigned notes use a single map-wide footprint index; only actual collisions
require additional movement. Promotion and lineage continuation retain positions.
Cloud membership changes never invoke group-circle repulsion. Initial bulk
separation, legacy repair, and visual contours have distinct private modules.
The discarded legacy blob generator and change-weighted group solver are removed.
New regions get deterministic local seeds independent of incoming cache hints;
newly isolated notes use free space outside accepted region bounds. Revision-zero
imports validate footprint collisions and release only overlapping placements.

## Verification

- All 68 Rust Atlas tests pass, including the 2,000-note fixture and native
  publication/restart/cache-loss integration test.
- Additions preserve every accepted note; equal-footprint rename/deletion retain
  positions and anchors even when conservative region circles overlap.
- Promotion now asserts exact coordinates and the continuation anchor.
- Isolated filename growth moves only the resized note and settles; new themes
  ignore divergent incoming hints; isolation checks actual hull exclusion.
- Revision-zero collision recovery preserves healthy placements and stays stable
  after serialization/restart.
- Follow-up Standards and Spec reviews found no remaining blocking findings.
- All 21 architecture fitness checks pass. `git diff --check` passes.

Layout algorithm version 24 invalidates derived artifacts through the existing
compatibility check. Durable accepted geography stays authoritative; this is not
a new placement migration or a global map reset.

## Limits

Organic contours retain their approved appearance and deterministic no-op behavior.
Perimeter resampling can still shift interpolation correspondence after a local
boundary change; that visual refinement is separate from accepted note movement.
This change does not reset healthy saved layouts or compact unrelated regions.

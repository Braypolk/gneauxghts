# 33: unicode discovery navigation

Status: ready-for-agent
Progress: complete; root integration and browser validation remain
Findings: ED04–05
Owner: editor audit agent

## Plan

Keep CodeMirror ranges UTF16; emit excerpt ranges in code points and avoid surrogate clipping. Coordinate documents agent openFlow migration with a full-document target resolver/reveal adapter in navigation.ts; canonical line offsets remain verified hints, never blind indices. Remove primary virtualized-DOM dependence.

## Validation

Emoji/cropping/multiline builder-to-renderer tests, unique/repeated/offscreen target resolution and focus/no-focus contracts; root owns browser scenario.

## Result

Implemented or evidence-backed disposition recorded in [editor remediation](../editor.md). Focused sweep: 44 files / 341 tests pass; parser refinement: 4 files / 33 tests pass. No full suites or commits.

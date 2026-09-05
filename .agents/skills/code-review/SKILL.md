---
name: code-review
description: Review a branch, commit range, or working-tree changes for correctness, repository standards, and spec coverage. Use for code reviews and verification of review fixes.
---

Review the agreed changes along two axes:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

For substantial reviews, use independent Standards and Spec sub-agents when
available. For a small, localized diff, review both axes locally; delegation
should buy independent coverage, not repeat the same inspection. This skill
reviews and reports; implement fixes when the user authorizes them.

Use the repository's issue-tracker instructions when present. Otherwise use
available issue/spec files or tracker tools; installing another skill is not a
prerequisite for reviewing code.

## Process

### 1. Establish the review scope

Use the user's baseline and scope, including choices established earlier in the
conversation. If omitted, inspect branch/commit context and state a reasonable
baseline. Ask only when materially different plausible baselines remain.

Resolve the reference and record the commits and comparison command. For a
branch review, use `git diff <base>...HEAD`; for work since an exact commit, use
`git diff <base> HEAD`. Include staged/unstaged changes when reviewing current
work or follow-up fixes, and inspect relevant untracked files separately.
Report an invalid reference or genuinely empty scope before delegating.

### 2. Identify the spec source

Find issue references in commits, a user-provided path, or matching local spec
files. Use the repository's tracker workflow where available. If no spec is
found, continue the standards/correctness review and identify the spec coverage
limit. Ask for a missing spec only when it prevents a consequential conclusion.
Future issues outside the agreed phase are not missing implementation findings.

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell suggests a question and a possible response. Apply a response only
when it reduces a demonstrated problem; the list does not prescribe refactors:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Inspect the change

For substantial reviews, delegate these two bounded inspections in parallel;
continue useful integration inspection locally. For small reviews, apply the
same briefs yourself. Follow-up reviews should focus on the correction and its
affected callers, not restart the entire baseline review.

**Standards sub-agent prompt** should include:

- The agreed scope, diff commands, and relevant commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Keep findings concise without omitting actionable evidence."

**Spec sub-agent prompt** should include:

- The agreed scope, diff commands, and relevant commit list.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Keep findings concise without omitting actionable evidence."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 5. Verify and report

Verify candidate findings against the actual call path and current code.
Prioritize actionable defects, unmet requirements, and complexity with a
concrete maintenance cost. Code smells are prompts for inspection, not quotas
or automatic reasons to introduce abstractions. A necessary adapter or repeated
boundary check can be simpler than removing it.

Run targeted reproductions when they materially establish a finding. Respect
required repository checks; a review does not automatically require every
available suite. Stop when the agreed scope has been assessed and findings
have adequate evidence. Additional checks should resolve a named uncertainty.

Combine duplicate findings and order actionable findings by severity, retaining
Standards/Spec labels so neither axis masks the other. Cite tight file/line
locations, the failure scenario or maintenance cost, and the applicable rule or
requirement. Distinguish confirmed defects from design judgments and validation
limits. State when an axis has no findings; avoid inventing work to fill it.

Finish with the readiness assessment and meaningful validation. Preserve both
axes in a concise format suited to the task rather than reproducing sub-agent
reports verbatim.

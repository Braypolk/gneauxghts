# Agent architecture patterns for composable note work

Researched 2026-09-28. Primary sources only. This is design guidance, not a production implementation or a claim that the current model passes live evaluations.

## Findings

**A model choosing tools in a feedback loop remains a sound foundation.** Anthropic distinguishes predefined workflow control from an agent choosing its own steps. Tool results supply environmental feedback, and stopping conditions bound execution. Its 2024 article now explicitly warns that its tooling discussion has aged; the control-flow distinction is still useful, but is not evidence for choosing a current SDK. [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

**The newer development is a stronger execution environment and harness, not the disappearance of tools.** Anthropic's April 2026 Managed Agents design separates a durable session log, the model/tool loop, and replaceable execution environments. The session can outlive context compaction or a harness crash; environments are invoked through tools when needed. This is a vendor architecture example, not evidence of one universal industry standard. [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents)

**Code can compose the same domain capabilities efficiently.** An agent can call APIs in a sandbox, paginate, filter, join, aggregate, and retain intermediate values without sending every intermediate result back through model context. This improves workloads with many calls or large structured results. It adds sandbox, resource-limit, and monitoring requirements; Anthropic explicitly says to weigh those costs against the benefit. Code execution does not supply missing APIs or data. [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

**Skills supply selectively loaded procedural knowledge.** Names and descriptions advertise capabilities; the agent loads the instructions and supporting resources when relevant. This can package recurring conventions without a separate agent per use case. It complements the operations exposed by tools, and should not become a mandatory predefined workflow for every user goal. That last sentence is our design recommendation, not a protocol guarantee. [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

**MCP standardizes the connection layer.** Its architecture documentation explicitly excludes dictating how an application uses models or manages context. Tools expose executable operations, resources expose contextual data, and prompts expose templates. Converting local tools to MCP would improve interoperability; it would not itself improve planning or evidence synthesis. [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture)

**Smallest possible operations are not automatically the best agent interface.** Anthropic recommends distinct, purposeful tools and permits combining routinely chained operations or enriching results with useful metadata. It recommends evaluation against realistic goals, measuring correctness, time, tokens, errors, and unnecessary calls without requiring one exact successful sequence. [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)

## Recommendation for this app

Keep the general agent loop and the existing typed domain operations as the foundation. Treat chat as one interaction surface over a run, with its goal, evidence, progress, budget, and pending proposals represented independently where longer-running work requires it. This is an architectural direction, not a finding that current state ownership must be rewritten.

Improve evidence contracts and measure actual model behavior first. The agent must be able to discover relevant notes, retrieve useful content and provenance, continue partial results, and tell when coverage is incomplete. A different runtime cannot retrieve history that policy or the storage/query interface excludes.

If representative tasks show repetitive pagination, copying, joins, counting, or batch reads consuming turns and context, prototype a bounded `execute` capability over the same APIs. Keep note permissions, citation admission, freshness, and proposal review enforced below both invocation paths. Give the sandbox only the approved API surface and a disposable workspace; direct canonical database/filesystem writes would bypass the application's domain guarantees.

Add skills when recurring procedural knowledge demonstrably improves outcomes, and MCP when other applications or external integrations need the capabilities. Neither needs to precede better autonomous composition of the current local tools. Additional workers should address parallelizable or context-heavy subtasks demonstrated by evaluations, rather than becoming the default architecture.

Compare current direct-tool execution against an optional code-composition prototype on recall, changed-note synthesis, open-task enumeration, cross-note comparison, and proposed edits. Assess final usefulness and factual coverage, citation validity, authorization preservation, completion rate, latency, and cost. Allow different successful tool sequences. Do not label an architecture best until those outcomes support it.

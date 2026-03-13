# Semantic Benchmark

Benchmark notes live in `~/Documents/Gneauxghts` with the prefix `Semantic Benchmark - `.
The manifest is `~/Documents/Gneauxghts/.gneauxghts-semantic-benchmark.json`.

## Setup

1. Open Settings.
2. If the model is not already cached, disable `Local-only Mode`, enable `Auto-download Models`, then click `Prepare local model`.
3. Re-enable `Local-only Mode` after the model is available if you want strictly offline behavior.
4. Click `Rebuild semantic index`.

## Search checks

- Query: `protect a port city from sea level rise and storm surge`
  Expected: `Semantic Benchmark - Harbor Flood Defenses`
- Query: `cool down city blocks with more shade and tree cover`
  Expected: `Semantic Benchmark - Urban Shade Plan`
- Query: `rituals that help distributed teammates feel connected`
  Expected: `Semantic Benchmark - Remote Team Rituals`
- Query: `how should an operations team learn after an outage`
  Expected: `Semantic Benchmark - Incident Review Practice`

## Related checks

- Open `Semantic Benchmark - Remote Team Rituals`
  Expected related note: `Semantic Benchmark - Incident Review Practice`
- Open `Semantic Benchmark - Harbor Flood Defenses`
  Expected related note: `Semantic Benchmark - Urban Shade Plan`

## Negative checks

- Search and related results for the benchmark notes should avoid surfacing:
  - `Semantic Benchmark - Analog Synth Patches`
  - `Semantic Benchmark - Sourdough Notebook`
  unless the query is directly about those topics.

<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { Cloud, FileText, Network, RefreshCw, Search } from '@lucide/svelte';
  import { loadNoteMap, type NoteMapEdge, type NoteMapNote } from '$lib/features/map/noteMap';

  type CloudNode = {
    id: string;
    label: string;
    notes: NoteMapNote[];
    strength: number;
    x: number;
    y: number;
    radius: number;
  };

  type CloudLink = {
    sourceId: string;
    targetId: string;
    score: number;
  };

  type NotePoint = NoteMapNote & {
    x: number;
    y: number;
    size: number;
  };

  let notes = $state<NoteMapNote[]>([]);
  let edges = $state<NoteMapEdge[]>([]);
  let semanticAvailable = $state(false);
  let isLoading = $state(true);
  let errorMessage = $state<string | null>(null);
  let selectedCloudId = $state<string | null>(null);
  let query = $state('');

  const filteredNotes = $derived.by(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return notes;
    return notes.filter((note) => {
      const haystack = [
        note.title,
        note.fileName,
        note.excerpt,
        ...note.sectionLabels
      ].join(' ').toLowerCase();
      return haystack.includes(normalized);
    });
  });

  const visiblePathSet = $derived.by(() => new Set(filteredNotes.map((note) => note.notePath)));
  const visibleEdges = $derived.by(() =>
    edges.filter((edge) => visiblePathSet.has(edge.sourceNotePath) && visiblePathSet.has(edge.targetNotePath))
  );
  const graph = $derived.by(() => buildCloudGraph(filteredNotes, visibleEdges));
  const selectedCloud = $derived.by(() =>
    graph.clouds.find((cloud) => cloud.id === selectedCloudId) ?? graph.clouds[0] ?? null
  );
  const selectedNotes = $derived.by(() =>
    selectedCloud ? buildNotePoints(selectedCloud.notes, selectedCloud.radius) : []
  );

  async function refreshMap(background = false) {
    if (!background) {
      isLoading = true;
    }
    errorMessage = null;
    try {
      const payload = await loadNoteMap();
      notes = payload.notes;
      edges = payload.edges;
      semanticAvailable = payload.semanticAvailable;
      selectedCloudId = null;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    void refreshMap();
  });

  afterNavigate(() => {
    void refreshMap(true);
  });

  function buildCloudGraph(sourceNotes: NoteMapNote[], sourceEdges: NoteMapEdge[]) {
    if (sourceNotes.length === 0) {
      return { clouds: [] as CloudNode[], links: [] as CloudLink[] };
    }

    const noteByPath = new Map(sourceNotes.map((note) => [note.notePath, note]));
    const parent = new Map(sourceNotes.map((note) => [note.notePath, note.notePath]));
    const rankedEdges = [...sourceEdges].sort((a, b) => b.score - a.score);
    const threshold = rankedEdges.length > 0 ? Math.max(0.32, rankedEdges[Math.min(24, rankedEdges.length - 1)].score * 0.72) : 1;

    for (const edge of rankedEdges) {
      if (edge.score < threshold) continue;
      union(parent, edge.sourceNotePath, edge.targetNotePath);
    }

    const buckets = new Map<string, NoteMapNote[]>();
    for (const note of sourceNotes) {
      const root = find(parent, note.notePath);
      const bucket = buckets.get(root) ?? [];
      bucket.push(note);
      buckets.set(root, bucket);
    }

    const clouds = [...buckets.values()]
      .map((bucket, index) => createCloud(bucket, sourceEdges, index))
      .sort((a, b) => b.strength - a.strength || b.notes.length - a.notes.length);
    const cloudByPath = new Map<string, string>();
    for (const cloud of clouds) {
      for (const note of cloud.notes) {
        cloudByPath.set(note.notePath, cloud.id);
      }
    }

    const linkScores = new Map<string, CloudLink>();
    for (const edge of sourceEdges) {
      const sourceId = cloudByPath.get(edge.sourceNotePath);
      const targetId = cloudByPath.get(edge.targetNotePath);
      if (!sourceId || !targetId || sourceId === targetId) continue;
      const [left, right] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];
      const key = `${left}:${right}`;
      const previous = linkScores.get(key);
      if (!previous || edge.score > previous.score) {
        linkScores.set(key, { sourceId: left, targetId: right, score: edge.score });
      }
    }

    const positioned = positionClouds(clouds);
    return { clouds: positioned, links: [...linkScores.values()].sort((a, b) => b.score - a.score).slice(0, 36) };
  }

  function createCloud(bucket: NoteMapNote[], sourceEdges: NoteMapEdge[], index: number): CloudNode {
    const paths = new Set(bucket.map((note) => note.notePath));
    const strength = sourceEdges.reduce((total, edge) => {
      if (paths.has(edge.sourceNotePath) && paths.has(edge.targetNotePath)) return total + edge.score;
      return total;
    }, 0);
    const radius = Math.min(28, 11 + Math.sqrt(bucket.length) * 5);
    return {
      id: `cloud-${index}-${bucket[0]?.noteId ?? index}`,
      label: labelCloud(bucket),
      notes: bucket.sort((a, b) => b.modifiedMillis - a.modifiedMillis),
      strength,
      x: 50,
      y: 50,
      radius
    };
  }

  function positionClouds(clouds: CloudNode[]) {
    if (clouds.length === 1) return [{ ...clouds[0], x: 50, y: 48 }];
    return clouds.map((cloud, index) => {
      const angle = -Math.PI / 2 + (index / clouds.length) * Math.PI * 2;
      const ring = index < 7 ? 32 : 41;
      const jitter = (index % 3) * 4;
      return {
        ...cloud,
        x: 50 + Math.cos(angle) * (ring + jitter),
        y: 50 + Math.sin(angle) * (ring - 4)
      };
    });
  }

  function labelCloud(bucket: NoteMapNote[]) {
    const counts = new Map<string, number>();
    for (const note of bucket) {
      for (const token of tokenize([...note.sectionLabels, note.title, note.fileName].join(' '))) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    const [first, second] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([word]) => word);
    return [first, second].filter(Boolean).map(capitalize).join(' ') || 'Unlabeled';
  }

  function buildNotePoints(sourceNotes: NoteMapNote[], cloudRadius: number): NotePoint[] {
    return sourceNotes.slice(0, 28).map((note, index) => {
      const angle = -Math.PI / 2 + index * 2.399963;
      const distance = Math.min(42, 9 + Math.sqrt(index + 1) * (cloudRadius * 0.62));
      return {
        ...note,
        x: 50 + Math.cos(angle) * distance,
        y: 50 + Math.sin(angle) * distance,
        size: Math.min(12, 5.8 + Math.log2(note.paragraphCount + note.taskCount + 2))
      };
    });
  }

  function find(parent: Map<string, string>, value: string): string {
    const current = parent.get(value) ?? value;
    if (current === value) return current;
    const root = find(parent, current);
    parent.set(value, root);
    return root;
  }

  function union(parent: Map<string, string>, left: string, right: string) {
    const leftRoot = find(parent, left);
    const rightRoot = find(parent, right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  }

  function tokenize(value: string) {
    const stop = new Set(['and', 'the', 'for', 'with', 'from', 'note', 'notes', 'markdown', 'todo', 'task']);
    return value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word))
      .slice(0, 40);
  }

  function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

<div class="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
  <main class="min-h-0 flex-1 overflow-hidden py-0 sm:py-4">
    <section class="mx-auto grid h-full w-full max-w-7xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-y border-border bg-card shadow-sm sm:rounded-[2rem] sm:border">
      <div class="border-b border-border px-4 py-4 sm:px-8 sm:py-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Network class="h-4 w-4" />
              <span>{filteredNotes.length} files</span>
              <span>{graph.clouds.length} clouds</span>
              <span>{visibleEdges.length} rankings</span>
            </div>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label class="relative block min-w-0 sm:w-72">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                class="h-10 w-full rounded-full border border-border bg-background pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/35"
                bind:value={query}
                placeholder="Filter files"
              />
            </label>
            <button
              type="button"
              class="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-muted px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-50"
              onclick={() => void refreshMap()}
              disabled={isLoading}
            >
              <RefreshCw class={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div class="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="relative min-h-[420px] overflow-hidden bg-background">
          {#if isLoading}
            <div class="absolute inset-0 flex items-center justify-center text-sm font-medium text-muted-foreground">
              Building semantic clouds
            </div>
          {:else if errorMessage}
            <div class="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-medium text-destructive">
              {errorMessage}
            </div>
          {:else if graph.clouds.length === 0}
            <div class="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-medium text-muted-foreground">
              No files match this view.
            </div>
          {:else}
            <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {#each graph.links as link}
                {@const source = graph.clouds.find((cloud) => cloud.id === link.sourceId)}
                {@const target = graph.clouds.find((cloud) => cloud.id === link.targetId)}
                {#if source && target}
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="currentColor"
                    class="text-border"
                    stroke-width={Math.max(0.18, link.score * 0.95)}
                    opacity={Math.min(0.72, Math.max(0.18, link.score))}
                  />
                {/if}
              {/each}
            </svg>

            {#each graph.clouds as cloud}
              <button
                type="button"
                class={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border px-3 text-center shadow-sm transition-all hover:scale-[1.03] ${
                  selectedCloud?.id === cloud.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-foreground hover:border-foreground/30'
                }`}
                style={`left:${cloud.x}%;top:${cloud.y}%;width:${cloud.radius * 2.15}%;aspect-ratio:1;`}
                onclick={() => selectedCloudId = cloud.id}
                aria-label={`Open ${cloud.label} cloud`}
              >
                <Cloud class="mb-1 h-5 w-5" />
                <span class="max-w-full truncate text-xs font-semibold sm:text-sm">{cloud.label}</span>
                <span class="mt-1 text-[11px] opacity-70">{cloud.notes.length} files</span>
              </button>
            {/each}
          {/if}
        </div>

        <aside class="min-h-0 border-t border-border bg-card lg:border-l lg:border-t-0">
          <div class="flex h-full min-h-0 flex-col">
            <div class="border-b border-border px-4 py-4">
              {#if selectedCloud}
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-base font-semibold">{selectedCloud.label}</p>
                    <p class="mt-1 text-sm text-muted-foreground">
                      {selectedCloud.notes.length} files, score {selectedCloud.strength.toFixed(2)}
                    </p>
                  </div>
                  <Cloud class="h-5 w-5 shrink-0 text-muted-foreground" />
                </div>
              {:else}
                <p class="text-sm font-medium text-muted-foreground">Select a cloud</p>
              {/if}
              {#if !semanticAvailable}
                <p class="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Semantic rankings appear after the local semantic index has files to compare.
                </p>
              {/if}
            </div>

            <div class="relative h-56 shrink-0 border-b border-border bg-background">
              {#if selectedCloud}
                {#each selectedNotes as note}
                  <span
                    class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card shadow-sm"
                    title={note.title}
                    style={`left:${note.x}%;top:${note.y}%;width:${note.size}%;aspect-ratio:1;`}
                  ></span>
                {/each}
              {/if}
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div class="space-y-2">
                {#each selectedCloud?.notes ?? [] as note}
                  <article class="rounded-lg border border-border bg-background px-3 py-3">
                    <div class="flex items-start gap-2">
                      <FileText class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div class="min-w-0">
                        <p class="truncate text-sm font-semibold" title={note.title}>{note.title}</p>
                        <p class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{note.excerpt || note.fileName}</p>
                      </div>
                    </div>
                  </article>
                {/each}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </main>
</div>

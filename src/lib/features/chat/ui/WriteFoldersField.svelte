<script lang="ts">
  let { value = $bindable(''), disabled = false }: { value?: string; disabled?: boolean } = $props();
</script>

<label class="grid gap-2 text-sm">
  <span>Allowed write folders</span>
  <textarea class="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
    aria-label="Allowed write folders" rows="3" bind:value {disabled} placeholder={'.\nProjects'} spellcheck="false"></textarea>
  <span class="text-xs leading-relaxed text-muted-foreground">
    One folder per line, relative to this vault. Use . for its root. Applies to enabled write operations.
    All enabled changes include each listed folder’s subfolders. Renames keep the note in its current folder.
  </span>
</label>

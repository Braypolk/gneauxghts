<script>
  let { children } = $props();
  import "../app.css";
</script>

<div class="min-h-full h-full">
  {@render children()}
</div>
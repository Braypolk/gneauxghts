<script lang="ts">
  let { armed }: { armed: boolean } = $props();
  function renderValue(shouldThrow: boolean) {
    if (shouldThrow) throw new Error('SECRET_note_path_token_request_body');
    return 'Child rendered normally';
  }
</script>

<p>{renderValue(armed)}</p>

<script lang="ts">
  import { page } from '$app/state';
  import { clientErrorDisplay } from '#lib/app/clientErrorPresentation.js';

  const display = $derived(clientErrorDisplay(page.error, page.status));
</script>

<main class="client-error" aria-labelledby="client-error-heading">
  <section>
    <h1 id="client-error-heading">{display.heading}</h1>
    <p>{display.message}</p>
    <label for="client-error-summary">Diagnostic summary</label>
    <textarea
      id="client-error-summary"
      readonly
      rows="3"
      value={`Status: ${display.status}\nReference: ${display.diagnosticId ?? 'Unavailable'}`}
    ></textarea>
    <p class="reference-help">The reference identifies this failure locally. It does not contain your notes.</p>
  </section>
</main>

<style>
  .client-error { height: 100%; overflow: auto; padding: clamp(1rem, 5vw, 3rem); }
  section { max-width: 36rem; margin: 2rem auto; }
  h1 { font-size: 1.5rem; font-weight: 600; }
  p { margin-block: 1rem; line-height: 1.5; }
  label { display: block; margin-bottom: 0.5rem; font-weight: 500; }
  textarea {
    box-sizing: border-box; width: 100%; padding: 0.75rem; border: 1px solid currentColor;
    border-radius: 0.5rem; color: inherit; background: transparent; font: inherit;
    resize: vertical; user-select: text;
  }
  textarea:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  .reference-help { font-size: 0.875rem; }
</style>

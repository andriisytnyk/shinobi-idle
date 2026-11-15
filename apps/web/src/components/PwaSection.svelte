<script lang="ts">
  import PwaPanel from './PwaPanel.svelte';
</script>

<!-- Registered in the settings slot by the built-in UI pack, like any pack's section would be. -->
<section class="app" data-ui="pwa-section">
  <PwaPanel />
</section>

<style>
  .app {
    margin-bottom: var(--space-6);
  }
</style>

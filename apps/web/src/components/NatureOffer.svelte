<script lang="ts">
  import { natureStatus } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';

  const content = game.content;

  const status = $derived(game.read((gs) => natureStatus(gs, content)));
  /** The nature test, or an extra nature once Chakra Control allows it. */
  const offer = $derived(status.canChoose);
  const ordinal = $derived(
    status.stage === 'third' ? 'nature.ordinal.thirdAcc' : 'nature.ordinal.secondAcc',
  );
</script>

{#if offer}
  <section class="offer" data-nature-offer={status.stage}>
    <p>
      {#if status.stage === 'test'}
        {t('nature.offer.test')}
      {:else}
        {t('nature.offer.add', { cc: status.cc, ordinal: t(ordinal) })}
      {/if}
    </p>
    <a class="go" href="#/nature" data-go>{t('nature.offer.go')}</a>
  </section>
{/if}

<style>
  .offer {
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border: var(--border-thin) dashed var(--accent);
    border-radius: var(--radius-md);
  }

  p {
    margin: 0 0 var(--space-2);
  }

  .go {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-md);
    padding: var(--space-1) var(--space-4);
    border: var(--border-thin) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--ink-900);
    font-weight: 600;
    text-decoration: none;
  }
</style>

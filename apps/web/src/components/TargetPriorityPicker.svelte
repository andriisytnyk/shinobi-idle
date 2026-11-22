<script lang="ts">
  import { game } from '../lib/store.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { targetPriorityNow } from '../lib/prep.ts';

  /*
   * Which enemy the character and the clones attack first when there are several: one choice for the
   * loadout, read by the fights that begin afterwards (and by the forecast on this screen). The
   * settings are the data of the content (`targetPriorities`), so a pack that adds one adds a choice here.
   */

  const content = game.content;

  const current = $derived(game.read((gs) => targetPriorityNow(gs, content)));

  const nameOf = (id: string) =>
    hasKey(`targetPriority.${id}.name`) ? t(`targetPriority.${id}.name`) : id;
  const descOf = (id: string) =>
    hasKey(`targetPriority.${id}.desc`) ? t(`targetPriority.${id}.desc`) : '';

  let message = $state<string | null>(null);

  function choose(event: Event): void {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const r = game.dispatch({ type: 'loadout.targetPriority', priority: id });
    message = r.ok ? null : (r.reason ?? 'error.unknown');
  }
</script>

{#if content.targetPriorities.length > 1}
  <section class="priority" data-ui="target-priority">
    <label class="line">
      <span class="title">{t('targetPriority.title')}</span>
      <select
        value={current}
        aria-label={t('targetPriority.group')}
        aria-describedby="target-priority-desc"
        onchange={choose}
      >
        {#each content.targetPriorities as p (p.id)}
          <option value={p.id}>{nameOf(p.id)}</option>
        {/each}
      </select>
    </label>
    <p class="note" id="target-priority-desc" data-target-priority-line>
      {current ? descOf(current) : ''}
    </p>
    <p class="note">{t('targetPriority.note')}</p>
    {#if message}<p class="message" role="status">{t(message)}</p>{/if}
  </section>
{/if}

<style>
  .priority {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .title {
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
  }

  select {
    min-height: var(--control-md);
    max-width: 100%;
  }

  .note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .message {
    margin: 0;
    color: var(--danger);
  }
</style>

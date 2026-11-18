<script lang="ts">
  import { game } from '../lib/store.ts';
  import { hasKey, t } from '../lib/i18n.ts';
  import { cloneRoleNow, knowsCombatClone } from '../lib/prep.ts';

  /*
   * The role all the combat clones take in a fight: one choice, shown only to a character who knows a
   * technique that makes combat clones. The roles are the data of the content (`cloneRoles`), so a
   * pack that adds one adds a choice here. The choice is read by the fights that begin afterwards.
   */

  const content = game.content;

  const view = $derived(
    game.read((gs) => ({
      shown: knowsCombatClone(gs, content),
      current: cloneRoleNow(gs, content),
    })),
  );

  const nameOf = (id: string) => (hasKey(`cloneRole.${id}.name`) ? t(`cloneRole.${id}.name`) : id);
  const descOf = (id: string) => (hasKey(`cloneRole.${id}.desc`) ? t(`cloneRole.${id}.desc`) : '');

  let message = $state<string | null>(null);

  function choose(id: string): void {
    const r = game.dispatch({ type: 'loadout.cloneRole', role: id });
    message = r.ok ? null : (r.reason ?? 'error.unknown');
  }
</script>

{#if view.shown && content.cloneRoles.length > 1}
  <section class="roles" data-ui="clone-roles">
    <h3>{t('cloneRole.title')}</h3>
    <p class="note">{t('cloneRole.note')}</p>
    <div class="choices" role="radiogroup" aria-label={t('cloneRole.group')}>
      {#each content.cloneRoles as role (role.id)}
        <label class="choice" class:on={view.current === role.id} data-clone-role={role.id}>
          <input
            type="radio"
            name="clone-role"
            value={role.id}
            checked={view.current === role.id}
            aria-labelledby="clone-role-{role.id}-name"
            aria-describedby="clone-role-{role.id}-desc"
            onchange={() => choose(role.id)}
          />
          <span class="text">
            <span class="name" id="clone-role-{role.id}-name">{nameOf(role.id)}</span>
            <span class="desc" id="clone-role-{role.id}-desc">{descOf(role.id)}</span>
          </span>
        </label>
      {/each}
    </div>
    {#if message}<p class="message" role="status">{t(message)}</p>{/if}
  </section>
{/if}

<style>
  .roles {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  h3 {
    margin: 0;
    color: var(--heading);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    font-weight: 400;
  }

  .note {
    margin: 0;
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .choice {
    display: flex;
    flex: 1 1 var(--card-min);
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--control-md);
    padding: var(--space-2);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    cursor: pointer;
  }

  .choice.on {
    border-color: var(--accent);
  }

  .choice:focus-within {
    outline: var(--border-thick) solid var(--accent);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .name {
    font-weight: 600;
  }

  .desc {
    color: var(--fg-dim);
    font-size: var(--text-xs);
  }

  .message {
    margin: 0;
    color: var(--danger);
  }
</style>

<script lang="ts">
  import { PLAYER_NAME_MAX } from '@shinobi/core';
  import { t } from '../lib/i18n.ts';
  import { game } from '../lib/store.ts';
  import Modal from './Modal.svelte';

  let name = $state('');
  let error = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();

  // The dialog takes focus when it opens; the name field takes it right after.
  $effect(() => {
    const id = window.setTimeout(() => input?.focus(), 0);
    return () => window.clearTimeout(id);
  });

  function submit(): void {
    const result = game.dispatch({ type: 'player.setName', name });
    error = result.ok ? null : result.reason;
  }
</script>

<!-- The welcome cannot be dismissed without a name, so Escape does nothing. -->
<Modal title={t('welcome.title')} onClose={() => {}}>
  <p>{t('welcome.body')}</p>
  <label class="field">
    <span>{t('welcome.name')}</span>
    <input
      bind:this={input}
      type="text"
      bind:value={name}
      maxlength={PLAYER_NAME_MAX}
      placeholder={t('welcome.placeholder')}
      autocomplete="off"
      onkeydown={(e) => {
        if (e.key === 'Enter' && name.trim() !== '') submit();
      }}
    />
  </label>
  {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
  {#snippet actions()}
    <button type="button" class="primary" disabled={name.trim() === ''} onclick={submit}>
      {t('welcome.start')}
    </button>
  {/snippet}
</Modal>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  input {
    min-height: var(--control-size);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
  }

  .error {
    color: var(--danger);
  }
</style>

<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import Icon from './Icon.svelte';

  interface Props {
    /** The mission needs a team (true) or is done alone. */
    team: boolean;
    /** Print the label beside the icon (the mission page); a card shows the icon alone. */
    text?: boolean;
  }

  let { team, text = false }: Props = $props();

  const label = $derived(t(team ? 'mission.team.yes' : 'mission.team.no'));
</script>

<!-- Not a button: it only says what kind of mission this is. -->
<span
  class="mark"
  class:text
  data-ui="mission-kind"
  data-team={team}
  role={text ? undefined : 'img'}
  aria-label={text ? undefined : label}
  title={label}
>
  <Icon name={team ? 'lucide:users' : 'lucide:user'} size={text ? 16 : 18} />
  {#if text}{label}{/if}
</span>

<style>
  .mark {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-height: var(--control-xs);
    color: var(--fg-dim);
    cursor: help;
  }

  .mark:not(.text) {
    min-width: var(--control-xs);
  }
</style>

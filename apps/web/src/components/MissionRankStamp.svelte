<script lang="ts">
  import { humanId } from '../lib/entities.ts';
  import { hasKey, t } from '../lib/i18n.ts';

  interface Props {
    /** A mission rank id of the content. */
    rank: string;
  }

  let { rank }: Props = $props();

  // Ranks that have no colour of their own in the palette fall back to the accent.
  const color = $derived(
    `var(--rank-${rank.toLowerCase().replace(/[^a-z0-9]/g, '')}, var(--accent))`,
  );
  const nameKey = $derived(`mission.rank.${rank}.name`);
  const label = $derived(hasKey(nameKey) ? t(nameKey) : humanId(rank));
  const stampKey = $derived(`mission.rank.${rank}.stamp`);
  /** What the stamp shows: the rank itself for a short id (D, C), the pack's own short text, or the first letter of the name. */
  const mark = $derived(
    hasKey(stampKey) ? t(stampKey) : rank.includes(':') ? label.charAt(0).toUpperCase() : rank,
  );
</script>

<span class="stamp" role="img" aria-label={label} style:--stamp={color}>{mark}</span>

<style>
  .stamp {
    --_size: 2.25rem;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: var(--_size);
    height: var(--_size);
    padding: 0 var(--space-1);
    border: var(--border-thick) solid var(--stamp);
    border-radius: var(--radius-sm);
    color: var(--stamp);
    font-family: var(--font-heading);
    font-size: var(--text-md);
    transform: rotate(-6deg);
  }
</style>

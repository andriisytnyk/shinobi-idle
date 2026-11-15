<script lang="ts">
  import { t } from '../lib/i18n.ts';
  import { hrefFor } from '../lib/route.ts';
  import { entityName } from '../lib/entities.ts';

  interface Props {
    /** The building that must reach a level. */
    id: string;
    level: number;
  }

  let { id, level }: Props = $props();
</script>

<!-- «Потрібно: Кузня рівня 2», the building being a link to its page. -->
<span class="need" data-building-need={id}>
  {t('reason.buildingNeed')}
  <a href={hrefFor({ kind: 'building', id })}>{entityName({ kind: 'building', id })}</a>
  {t('reason.buildingLevel', { n: level })}
</span>

<style>
  a {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-md);
  }

  @media (min-width: 769px) {
    a {
      min-height: 0;
    }
  }
</style>

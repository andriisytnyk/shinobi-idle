<script lang="ts">
  import { t } from '../lib/i18n.ts';

  interface Props {
    /** The section on screen. */
    current: 'quests' | 'missions';
  }

  let { current }: Props = $props();
</script>

<!-- On a phone the «Журнал» tab holds two sections; on a wide screen the sidebar lists both pages. -->
<nav class="journal" aria-label={t('journal.sections')} data-journal-tabs>
  <a
    href="#/quests"
    class:active={current === 'quests'}
    aria-current={current === 'quests' ? 'page' : undefined}
    data-journal="quests">{t('journal.quests')}</a
  >
  <a
    href="#/missions"
    class:active={current === 'missions'}
    aria-current={current === 'missions' ? 'page' : undefined}
    data-journal="missions">{t('journal.missions')}</a
  >
</nav>

<style>
  .journal {
    display: none;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
  }

  a {
    display: inline-flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: var(--control-md);
    border: var(--border-thin) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--fg);
    text-decoration: none;
  }

  a.active {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  @media (max-width: 768px) {
    .journal {
      display: flex;
    }
  }
</style>

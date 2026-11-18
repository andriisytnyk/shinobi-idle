<script lang="ts">
  import { untrack } from 'svelte';
  import { performersOf, squadNotices, type Performer } from '../lib/squad.ts';
  import { squadUi } from '../lib/squad-ui.svelte.ts';
  import { game } from '../lib/store.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  /**
   * Says what happens in the squad between two updates: a clone that became free, a clone that has
   * five minutes left. It draws nothing. The clones the player dispels or loses are announced by the
   * dispel itself and by the action-stopped toasts.
   */
  const content = game.content;
  let before: Performer[] | null = null;
  const warned = new Set<number>();

  $effect(() => {
    void game.version;
    untrack(() => {
      const now = performersOf(game.state, content);
      if (before) {
        for (const notice of squadNotices(before, now, warned)) {
          const give = notice.key === 'squad.notice.free';
          toasts.push({
            key: notice.key,
            params: { n: notice.n, min: notice.min ?? 0 },
            ...(give
              ? {
                  action: {
                    labelKey: 'squad.giveTask',
                    run: () => {
                      squadUi.pick(notice.n);
                    },
                  },
                }
              : {}),
          });
        }
      }
      before = now;
    });
  });
</script>

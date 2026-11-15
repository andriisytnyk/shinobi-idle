<script lang="ts">
  import { untrack } from 'svelte';
  import { useUi, type Runnable } from './runtime.svelte.ts';

  interface Props {
    entry: Runnable;
    ctx: unknown;
    /** Extra class for the container. */
    class?: string;
  }

  let { entry, ctx, class: className = '' }: Props = $props();

  const ui = useUi();
  let el = $state<HTMLElement>();
  /** The widget starts again when its context changes, not when the object is rebuilt. */
  const ctxKey = $derived(JSON.stringify(ctx));

  $effect(() => {
    void ctxKey;
    const target = el;
    if (!target) return;
    const current = untrack(() => ctx);
    return untrack(() => ui.run(entry, target, current));
  });
</script>

<div bind:this={el} class={['ui-widget', className]} data-ui-widget={entry.key}></div>

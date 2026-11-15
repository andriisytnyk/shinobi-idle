<script lang="ts">
  import type { IconRef } from '@shinobi/content';
  import { iconTint, resolveIcon } from '../lib/icons.ts';

  interface Props {
    /** An entity (`kind` + `id`); its icon and tint come from the registry. */
    entity?: IconRef;
    /** A raw icon name: a game-icons name, or `lucide:<name>` for a general UI icon. */
    name?: string;
    size?: number;
  }

  let { entity, name, size = 20 }: Props = $props();

  // Bodies are bundled at build time from the icon packages, so injecting them is safe.
  const icon = $derived(resolveIcon(entity ?? name ?? ''));
  const tint = $derived(entity ? iconTint(entity) : undefined);
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 {icon.size} {icon.size}"
  style:color={tint}
  aria-hidden="true"
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html icon.body}
</svg>

<style>
  .icon {
    flex: none;
  }
</style>

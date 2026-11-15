import { mount, unmount, type Component } from 'svelte';
import type { SlotName } from './slots.ts';
import type { Widget } from './types.ts';

/**
 * Adapts a Svelte component to the framework-independent widget contract. The component gets
 * `api` and `ctx` as props (when it declares them) and lives in a Svelte root of its own inside the slot's container.
 */
export function svelteWidget<N extends SlotName = SlotName>(
  // A component may declare `api` and `ctx` props, or none at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>,
): Widget<N> {
  return (el, api, ctx) => {
    const app = mount(component, { target: el, props: { api, ctx } as never });
    return () => {
      void unmount(app);
    };
  };
}

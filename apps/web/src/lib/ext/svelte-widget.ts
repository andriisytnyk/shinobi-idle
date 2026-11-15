import { mount, unmount, type Component } from 'svelte';
import type { SlotContext, SlotName } from './slots.ts';
import type { UiApi, Widget } from './types.ts';

/**
 * Adapts a Svelte component to the framework-independent widget contract. The component gets
 * `api` and `ctx` as props and lives in a Svelte root of its own inside the slot's container.
 */
export function svelteWidget<N extends SlotName = SlotName>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<{ api: UiApi; ctx: SlotContext<N> } & Record<string, any>>,
): Widget<N> {
  return (el, api, ctx) => {
    const app = mount(component, { target: el, props: { api, ctx } });
    return () => {
      void unmount(app);
    };
  };
}

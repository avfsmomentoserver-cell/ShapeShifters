import { Locator, LocatorSelectors, PrettyDOMOptions } from "vitest/browser";
import React from "react";
import { RootOptions } from "react-dom/client";

//#region src/pure.d.ts
interface RenderResult extends LocatorSelectors {
  container: HTMLElement;
  baseElement: HTMLElement;
  locator: Locator;
  debug: (el?: HTMLElement | HTMLElement[] | Locator | Locator[], maxLength?: number, options?: PrettyDOMOptions) => void;
  /** Unmount the component. Also records a `react.unmount` trace mark. */
  unmount: () => Promise<void>;
  /** Re-render the component with new props. Also records a `react.rerender` trace mark. */
  rerender: (ui: React.ReactNode) => Promise<void>;
  asFragment: () => DocumentFragment;
}
interface ComponentRenderOptions {
  container?: HTMLElement;
  baseElement?: HTMLElement;
  wrapper?: React.JSXElementConstructor<{
    children: React.ReactNode;
  }>;
  /**
  * Options passed to React's `createRoot`.
  *
  * @see {@link https://react.dev/reference/react-dom/client/createRoot API Reference for `createRoot`}
  */
  createRootOptions?: RootOptions;
}
interface RenderOptions extends ComponentRenderOptions {}
/**
* Render a React component into the document.
* Also records a `react.render` trace mark.
*/
declare function render(ui: React.ReactNode, {
  container,
  baseElement,
  wrapper: WrapperComponent,
  createRootOptions
}?: RenderOptions): Promise<RenderResult>;
interface RenderHookOptions<Props> extends ComponentRenderOptions {
  /**
  * The argument passed to the renderHook callback. Can be useful if you plan
  * to use the rerender utility to change the values passed to your hook.
  */
  initialProps?: Props | undefined;
}
interface RenderHookResult<Result, Props> {
  /**
  * Triggers a re-render. The props will be passed to your renderHook callback.
  */
  rerender: (props?: Props) => Promise<void>;
  /**
  * This is a stable reference to the latest value returned by your renderHook
  * callback
  */
  result: {
    /**
    * The value returned by your renderHook callback
    */
    current: Result;
  };
  /**
  * Unmounts the test component. This is useful for when you need to test
  * any cleanup your useEffects have.
  */
  unmount: () => Promise<void>;
  /**
  * A test helper to apply pending React updates before making assertions.
  */
  act: (callback: () => unknown) => Promise<void>;
}
declare function renderHook<Props, Result>(renderCallback: (initialProps?: Props) => Result, options?: RenderHookOptions<Props>): Promise<RenderHookResult<Result, Props>>;
declare function cleanup(): Promise<void>;
interface RenderConfiguration {
  reactStrictMode: boolean;
}
declare function configure(customConfig: Partial<RenderConfiguration>): void;
//#endregion
export { RenderOptions as a, configure as c, RenderHookResult as i, render as l, RenderConfiguration as n, RenderResult as o, RenderHookOptions as r, cleanup as s, ComponentRenderOptions as t, renderHook as u };
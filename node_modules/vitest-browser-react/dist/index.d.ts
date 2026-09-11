import { a as RenderOptions, i as RenderHookResult, l as render, o as RenderResult, r as RenderHookOptions, s as cleanup, t as ComponentRenderOptions, u as renderHook } from "./pure-D3zn6vz_.js";

//#region src/index.d.ts
declare module "vitest/browser" {
  interface BrowserPage {
    render: typeof render;
    renderHook: typeof renderHook;
  }
}
//#endregion
export { type ComponentRenderOptions, type RenderHookOptions, type RenderHookResult, type RenderOptions, type RenderResult, cleanup, render, renderHook };
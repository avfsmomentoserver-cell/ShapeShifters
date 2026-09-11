import { i as renderHook, r as render, t as cleanup } from "./pure-C_qo4W4L.js";
import { page } from "vitest/browser";
import { beforeEach } from "vitest";

//#region src/index.ts
page.extend({
	render,
	renderHook,
	[Symbol.for("vitest:component-cleanup")]: cleanup
});
beforeEach(async () => {
	await cleanup();
});

//#endregion
export { cleanup, render, renderHook };
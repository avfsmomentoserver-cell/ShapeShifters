import { page, server, utils } from "vitest/browser";
import React from "react";
import ReactDOMClient from "react-dom/client";
import { jsx } from "react/jsx-runtime";

//#region src/pure.tsx
const { debug, getElementLocatorSelectors } = utils;
let idx = 0;
function ensureTestIdAttribute(element) {
	const attributeId = server.config.browser.locators.testIdAttribute;
	if (!element.hasAttribute(attributeId)) element.setAttribute(attributeId, `__vitest_${idx++}__`);
}
let activeActs = 0;
function setActEnvironment(env) {
	globalThis.IS_REACT_ACT_ENVIRONMENT = env;
}
function updateActEnvironment() {
	setActEnvironment(activeActs > 0);
}
const _act = React.act || React.unstable_act;
const act = typeof _act !== "function" ? async (cb) => {
	await cb();
} : async (cb) => {
	activeActs++;
	updateActEnvironment();
	try {
		await _act(cb);
	} finally {
		activeActs--;
		updateActEnvironment();
	}
};
const mountedContainers = /* @__PURE__ */ new Set();
const mountedRootEntries = [];
/**
* Render a React component into the document.
* Also records a `react.render` trace mark.
*/
async function render(ui, { container, baseElement, wrapper: WrapperComponent, createRootOptions } = {}) {
	if (!baseElement) baseElement = document.body;
	if (!container) container = baseElement.appendChild(document.createElement("div"));
	ensureTestIdAttribute(baseElement);
	ensureTestIdAttribute(container);
	let root;
	if (!mountedContainers.has(container)) {
		root = createConcurrentRoot(container, createRootOptions);
		mountedRootEntries.push({
			container,
			root
		});
		mountedContainers.add(container);
	} else mountedRootEntries.forEach((rootEntry) => {
		/* istanbul ignore else */
		if (rootEntry.container === container) root = rootEntry.root;
	});
	await act(async () => {
		root.render(strictModeIfNeeded(wrapUiIfNeeded(ui, WrapperComponent)));
	});
	const locator = page.elementLocator(container);
	await mark(locator, "react.render", render);
	const renderResult = {
		container,
		baseElement,
		locator,
		debug: (el, maxLength, options) => debug(el, maxLength, options),
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
			await mark(locator, "react.unmount", renderResult.unmount);
		},
		rerender: async (newUi) => {
			await act(async () => {
				root.render(strictModeIfNeeded(wrapUiIfNeeded(newUi, WrapperComponent)));
			});
			await mark(locator, "react.rerender", renderResult.rerender);
		},
		asFragment: () => {
			return document.createRange().createContextualFragment(container.innerHTML);
		},
		...getElementLocatorSelectors(baseElement)
	};
	return renderResult;
}
function mark(locator, name, fn) {
	if (!locator.mark) return;
	const error = new Error(name);
	if ("captureStackTrace" in Error) Error.captureStackTrace(error, fn);
	return locator.mark(name, error);
}
async function renderHook(renderCallback, options = {}) {
	const { initialProps,...renderOptions } = options;
	const result = React.createRef();
	function TestComponent({ renderCallbackProps }) {
		const pendingResult = renderCallback(renderCallbackProps);
		React.useEffect(() => {
			result.current = pendingResult;
		});
		return null;
	}
	const { rerender: baseRerender, unmount } = await render(/* @__PURE__ */ jsx(TestComponent, { renderCallbackProps: initialProps }), renderOptions);
	function rerender(rerenderCallbackProps) {
		return baseRerender(/* @__PURE__ */ jsx(TestComponent, { renderCallbackProps: rerenderCallbackProps }));
	}
	return {
		result,
		rerender,
		unmount,
		act
	};
}
async function cleanup() {
	for (const { root, container } of mountedRootEntries) {
		await act(async () => {
			root.unmount();
		});
		if (container.parentNode === document.body) document.body.removeChild(container);
	}
	mountedRootEntries.length = 0;
	mountedContainers.clear();
}
function createConcurrentRoot(container, options) {
	const root = ReactDOMClient.createRoot(container, options);
	return {
		render(element) {
			root.render(element);
		},
		unmount() {
			root.unmount();
		}
	};
}
const config = { reactStrictMode: false };
function strictModeIfNeeded(innerElement) {
	return config.reactStrictMode ? React.createElement(React.StrictMode, null, innerElement) : innerElement;
}
function wrapUiIfNeeded(innerElement, wrapperComponent) {
	return wrapperComponent ? React.createElement(wrapperComponent, null, innerElement) : innerElement;
}
function configure(customConfig) {
	Object.assign(config, customConfig);
}

//#endregion
export { renderHook as i, configure as n, render as r, cleanup as t };
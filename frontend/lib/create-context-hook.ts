/**
 * Minimal typed create-context-hook utility (local implementation matching
 * the @nkzw/create-context-hook API, which is unavailable in this sandbox).
 */
import { createContext, createElement, useContext, type ReactNode } from "react";

/** Creates a provider component plus a typed access hook from a factory. */
export function createContextHook<T>(factory: () => T) {
  const Context = createContext<T | null>(null);
  const Provider = ({ children }: { children: ReactNode }) =>
    createElement(Context.Provider, { value: factory() }, children);
  const useStore = (): T => {
    const value = useContext(Context);
    if (value === null) throw new Error("useStore must be used within its Provider");
    return value;
  };
  return [Provider, useStore] as const;
}

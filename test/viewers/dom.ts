/** A DOM for hook tests (happy-dom) and a minimal renderHook over react-dom's act. */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!(globalThis as { document?: unknown }).document) GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

export async function renderHook<Props, Result>(hook: (props: Props) => Result, initial: Props) {
  const box: { current: Result } = { current: undefined as Result };
  const container = document.createElement("div");
  const root = createRoot(container);
  const Probe = (props: { p: Props }) => { box.current = hook(props.p); return null; };
  await act(async () => { root.render(createElement(Probe, { p: initial })); });
  return {
    result: box,
    rerender: async (props: Props) => { await act(async () => { root.render(createElement(Probe, { p: props })); }); },
    /** Runs work inside act and lets effects and promises settle. */
    act: async <T>(work: () => T | Promise<T>): Promise<T> => { let out!: T; await act(async () => { out = await work(); }); return out; },
    settle: async (ms = 10) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

/** A tiny external store: the state a viewer shows, read by `useSyncExternalStore`. Presentation state only (BORING-4). */
export type Store<State> = Readonly<{
  get(): State;
  set(next: Partial<State> | ((state: State) => Partial<State>)): void;
  subscribe(listener: () => void): () => void;
}>;

export function createStore<State extends object>(initial: State): Store<State> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const patch = typeof next === "function" ? next(state) : next;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

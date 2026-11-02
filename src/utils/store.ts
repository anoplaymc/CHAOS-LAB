/** Minimal external store. Keeps React renders cheap: components select only the slice they need. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}

  get = (): T => this.state;

  set = (patch: Partial<T>): void => {
    let changed = false;
    for (const k in patch) {
      if (!Object.is(this.state[k], patch[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

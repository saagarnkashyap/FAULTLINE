export const WARNING_GAP_MS = 2000;

/** UI-only reveal queue. Updating the live data never restarts an existing wait. */
export function createWarningCadence(onReveal: (ids: readonly string[]) => void, initialIds: readonly string[] = []) {
  const revealed = new Set(initialIds);
  let current: readonly string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const pending = () => current.find((id) => !revealed.has(id));
  function schedule() {
    if (disposed || timer !== null || !pending()) return;
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      const id = pending();
      if (id) { revealed.add(id); onReveal([...revealed]); }
      schedule();
    }, WARNING_GAP_MS);
  }
  return {
    update(ids: readonly string[]) {
      if (disposed) return;
      current = ids;
      if (!pending() && timer !== null) { clearTimeout(timer); timer = null; }
      schedule();
    },
    dispose() { disposed = true; if (timer !== null) clearTimeout(timer); timer = null; },
  };
}

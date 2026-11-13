import { useEffect, useRef, useState } from "react";
import { createWarningCadence } from "../components/warningCadence";

export function useWarningCadence(ids: readonly string[], session: string) {
  const latest = useRef(ids);
  latest.current = ids;
  const [revealed, setRevealed] = useState<readonly string[]>(ids.slice(0, 1));
  const queue = useRef<ReturnType<typeof createWarningCadence> | null>(null);
  const signature = JSON.stringify(ids);
  useEffect(() => {
    const first = latest.current.slice(0, 1);
    setRevealed(first);
    const cadence = createWarningCadence(setRevealed, first);
    queue.current = cadence;
    cadence.update(latest.current);
    return () => { cadence.dispose(); queue.current = null; };
  }, [session]);
  useEffect(() => { queue.current?.update(latest.current); }, [signature]);
  return revealed;
}

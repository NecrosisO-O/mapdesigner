import { useRef, useState } from "react";

/** A form submission belongs to one map session, even if the user switches away. */
export function useEditorTask(mapId: string | undefined) {
  const scope = useRef({ mapId, generation: 0 });
  if (scope.current.mapId !== mapId)
    scope.current = { mapId, generation: scope.current.generation + 1 };
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    if (!mapId || busy.current) return null;
    const generation = scope.current.generation;
    busy.current = true;
    setPending(true);
    try {
      const result = await action();
      return generation === scope.current.generation ? result : null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { pending, run };
}

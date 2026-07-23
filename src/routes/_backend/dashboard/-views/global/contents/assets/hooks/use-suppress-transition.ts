import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Returns `true` for a single frame whenever `value` changes, so CSS
 * transitions can be disabled while a new state is applied instantly.
 *
 * Used when switching folders: the saved collapse / split state should snap
 * into place with no expand/collapse animation, while manual toggles within a
 * folder keep their smooth transition.
 */
export const useSuppressTransition = (value: unknown): boolean => {
  const [suppress, setSuppress] = useState(false);
  const lastValueRef = useRef(value);

  useLayoutEffect(() => {
    if (lastValueRef.current !== value) {
      lastValueRef.current = value;
      setSuppress(true);
    }
  }, [value]);

  useEffect(() => {
    if (!suppress) return;
    const id = requestAnimationFrame(() => setSuppress(false));
    return () => cancelAnimationFrame(id);
  }, [suppress]);

  return suppress;
};

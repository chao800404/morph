/**
 * A loader whose result the browser keeps for the rest of the page's life.
 *
 * For values that cannot change while a page is open, such as the origin the
 * app is addressed by. A route's `beforeLoad` runs on every navigation, search
 * changes included, and asking the server again each time is a round trip that
 * returns the same answer.
 *
 * On the server every call loads: a module there serves many requests, and one
 * request's answer is not another's. A failed load is not kept, so the next
 * call tries again.
 */
export function onceInBrowser<T>(
  load: () => Promise<T>,
  isBrowser: () => boolean = () => typeof window !== "undefined",
): () => Promise<T> {
  let kept: Promise<T> | undefined;
  return () => {
    if (!isBrowser()) return load();
    if (!kept) {
      kept = load().catch((error: unknown) => {
        kept = undefined;
        throw error;
      });
    }
    return kept;
  };
}

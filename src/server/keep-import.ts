/**
 * A lazy `import()` whose module is loaded once and then kept.
 *
 * The Worker entry loads most of its subsystems on demand, so that a request
 * never fails because of a subsystem it does not use. Written as a bare
 * `await import(...)` inside the handler, that load is repeated on every
 * request. Deployed, repeating it is cheap. Under `pnpm dev` it is not: the
 * Worker runs in Vite's module runner, which asks the dev server about the
 * module on every `import()` call, even one it has already evaluated
 * (`fetchModule` in Vite's `ModuleRunner.getModuleInformation`). Measured with
 * three editors open on a Start preview, those round trips were about 1.4s of
 * each preview request's 2.4s.
 *
 * Only the module is kept — never anything read from a request, `env` or a
 * routing decision. Callers still read those per request.
 *
 * Concurrent callers share one load. A failed load is not kept, so the next
 * call tries again; the failure clears only its own load, never one that
 * replaced it.
 *
 * Nothing is kept across a hot update: Vite re-runs the Worker entry when a
 * module it imports changes, and the entry creates its loaders afresh.
 */
export function keepImport<T>(load: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | undefined;
  return () => {
    if (kept) return kept;
    const attempt = load();
    kept = attempt;
    attempt.catch(() => {
      if (kept === attempt) kept = undefined;
    });
    return attempt;
  };
}

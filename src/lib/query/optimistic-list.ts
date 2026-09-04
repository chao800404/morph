import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** The shape every list server function resolves to. */
type CachedList<TRow> = { success: boolean; data?: TRow[] | null };

export interface OptimisticListSnapshot {
  entries: [QueryKey, unknown][];
}

/**
 * Applies a change to every cached list under a key prefix, reversibly.
 *
 * Written once because the sequence is easy to get subtly wrong and there is
 * no way to see it is wrong: without `cancelQueries` an in-flight refetch
 * lands after the patch and silently undoes it, and without the snapshot a
 * failed write leaves the screen showing something the server never accepted —
 * which is worse than not being optimistic at all.
 *
 * Every cached variant is patched, not just the visible one. The same thread
 * is cached under `all`, `open` and `resolved`, and per group; patching one
 * leaves the others to contradict it the moment the person switches filter.
 */
export function patchCachedLists<TRow>(
  queryClient: QueryClient,
  prefix: QueryKey,
  patch: (rows: TRow[]) => TRow[],
): OptimisticListSnapshot {
  const entries = queryClient.getQueriesData({ queryKey: prefix });

  queryClient.setQueriesData<CachedList<TRow>>(
    { queryKey: prefix },
    (previous) => {
      if (!previous?.success || !Array.isArray(previous.data)) return previous;
      return { ...previous, data: patch(previous.data) };
    },
  );

  return { entries: entries as [QueryKey, unknown][] };
}

/** Puts back exactly what was cached before the patch. */
export function restoreCachedLists(
  queryClient: QueryClient,
  snapshot: OptimisticListSnapshot | undefined,
): void {
  if (!snapshot) return;
  for (const [key, value] of snapshot.entries) {
    queryClient.setQueryData(key, value);
  }
}

/**
 * The three handlers an optimistic list write needs.
 *
 * Spread into `useMutation` so a call site declares only what changes, and
 * cannot forget the cancel, the rollback or the final reconcile.
 */
export function optimisticListMutation<TRow, TVars>(options: {
  queryClient: QueryClient;
  prefix: QueryKey;
  patch: (rows: TRow[], variables: TVars) => TRow[];
  onError?: (error: Error, variables: TVars) => void;
}) {
  return {
    onMutate: async (variables: TVars) => {
      // An in-flight refetch would resolve after this and overwrite it.
      await options.queryClient.cancelQueries({ queryKey: options.prefix });
      return patchCachedLists<TRow>(
        options.queryClient,
        options.prefix,
        (rows) => options.patch(rows, variables),
      );
    },
    onError: (
      error: Error,
      variables: TVars,
      snapshot: OptimisticListSnapshot | undefined,
    ) => {
      restoreCachedLists(options.queryClient, snapshot);
      options.onError?.(error, variables);
    },
    // Settled rather than success: a rolled-back failure still leaves the
    // cache guessing, and the server is the only thing that actually knows.
    onSettled: () => {
      void options.queryClient.invalidateQueries({ queryKey: options.prefix });
    },
  };
}

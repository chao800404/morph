import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  optimisticListMutation,
  patchCachedLists,
  restoreCachedLists,
} from "./optimistic-list";

type Row = { id: string; status: "open" | "resolved" };

const prefix = ["comments"] as const;

function seed() {
  const client = new QueryClient();
  client.setQueryData([...prefix, "list", "all"], {
    success: true,
    data: [
      { id: "a", status: "open" },
      { id: "b", status: "open" },
    ] satisfies Row[],
  });
  client.setQueryData([...prefix, "list", "open"], {
    success: true,
    data: [{ id: "a", status: "open" }] satisfies Row[],
  });
  return client;
}

const rowsAt = (client: QueryClient, key: readonly unknown[]) =>
  (client.getQueryData(key) as { data: Row[] }).data;

describe("patchCachedLists", () => {
  it("patches every cached variant, not just the visible one", () => {
    // The same thread is cached under `all`, `open` and `resolved`. Patching
    // one leaves the others to contradict it the moment the filter changes.
    const client = seed();

    patchCachedLists<Row>(client, prefix, (rows) =>
      rows.filter((row) => row.id !== "a"),
    );

    expect(rowsAt(client, [...prefix, "list", "all"])).toEqual([
      { id: "b", status: "open" },
    ]);
    expect(rowsAt(client, [...prefix, "list", "open"])).toEqual([]);
  });

  it("leaves a failed response alone", () => {
    // Patching an error payload would invent a list where the query has none.
    const client = new QueryClient();
    client.setQueryData([...prefix, "list"], { success: false, data: null });

    patchCachedLists<Row>(client, prefix, () => [{ id: "x", status: "open" }]);

    expect(client.getQueryData([...prefix, "list"])).toEqual({
      success: false,
      data: null,
    });
  });

  it("restores exactly what was cached", () => {
    const client = seed();
    const before = rowsAt(client, [...prefix, "list", "all"]);

    const snapshot = patchCachedLists<Row>(client, prefix, () => []);
    expect(rowsAt(client, [...prefix, "list", "all"])).toEqual([]);

    restoreCachedLists(client, snapshot);
    expect(rowsAt(client, [...prefix, "list", "all"])).toEqual(before);
  });

  it("restores nothing when there is no snapshot", () => {
    const client = seed();
    expect(() => restoreCachedLists(client, undefined)).not.toThrow();
  });
});

describe("optimisticListMutation", () => {
  it("cancels in-flight fetches before patching", async () => {
    // A refetch that resolves after the patch would silently undo it.
    const client = seed();
    const cancel = vi.spyOn(client, "cancelQueries").mockResolvedValue();

    const handlers = optimisticListMutation<Row, { id: string }>({
      queryClient: client,
      prefix,
      patch: (rows, { id }) => rows.filter((row) => row.id !== id),
    });
    await handlers.onMutate({ id: "a" });

    expect(cancel).toHaveBeenCalledWith({ queryKey: prefix });
    expect(rowsAt(client, [...prefix, "list", "all"])).toEqual([
      { id: "b", status: "open" },
    ]);
  });

  it("rolls back and reports when the write fails", async () => {
    const client = seed();
    const onError = vi.fn();
    const handlers = optimisticListMutation<Row, { id: string }>({
      queryClient: client,
      prefix,
      patch: (rows, { id }) => rows.filter((row) => row.id !== id),
      onError,
    });

    const snapshot = await handlers.onMutate({ id: "a" });
    handlers.onError(new Error("nope"), { id: "a" }, snapshot);

    expect(rowsAt(client, [...prefix, "list", "all"])).toHaveLength(2);
    expect(onError).toHaveBeenCalled();
  });

  it("reconciles with the server whether or not it succeeded", () => {
    // A rolled-back failure still leaves the cache guessing.
    const client = seed();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue();

    optimisticListMutation<Row, void>({
      queryClient: client,
      prefix,
      patch: (rows) => rows,
    }).onSettled();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: prefix });
  });
});

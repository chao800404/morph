/**
 * The two rules that keep a fast typist from losing an edit.
 *
 * Both lived as bare `Map`s in refs inside the editor shell, where the only
 * way to ask what happens when a slow save is overtaken by a fast one was to
 * type quickly in a browser and hope the race showed itself.
 */
import { describe, expect, it } from "vitest";
import { createThemeFileSaveQueue } from "./theme-file-save-queue";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("claiming a revision", () => {
  it("counts up per file, independently", () => {
    const queue = createThemeFileSaveQueue();

    expect(queue.claimRevision("a")).toBe(1);
    expect(queue.claimRevision("a")).toBe(2);
    expect(queue.claimRevision("b")).toBe(1);
    expect(queue.latestRevision("a")).toBe(2);
  });

  it("reports zero for a file nothing has been claimed for", () => {
    expect(createThemeFileSaveQueue().latestRevision("never")).toBe(0);
  });
});

describe("running in order", () => {
  it("does not start a save while another is in flight", async () => {
    const queue = createThemeFileSaveQueue();
    const first = deferred<string>();
    const ran: string[] = [];

    const a = queue.enqueue({
      queueKey: "theme",
      fileKey: "a",
      revision: queue.claimRevision("a"),
      task: async () => {
        ran.push("a-start");
        await first.promise;
        ran.push("a-end");
        return "a";
      },
      superseded: () => "skipped",
    });
    const b = queue.enqueue({
      queueKey: "theme",
      fileKey: "b",
      revision: queue.claimRevision("b"),
      task: async () => {
        ran.push("b");
        return "b";
      },
      superseded: () => "skipped",
    });

    // The chain is `previous.catch().then()`, so the first task starts a couple
    // of microtasks in rather than synchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toEqual(["a-start"]);

    first.resolve("a");
    await Promise.all([a, b]);
    expect(ran).toEqual(["a-start", "a-end", "b"]);
  });

  it("lets the queue continue after one save throws", async () => {
    // A conflict on one file is not everyone's problem: the queue orders
    // writes, it does not make them depend on each other succeeding.
    const queue = createThemeFileSaveQueue();
    const failing = queue.enqueue({
      queueKey: "theme",
      fileKey: "a",
      revision: queue.claimRevision("a"),
      task: async () => {
        throw new Error("conflict");
      },
      superseded: () => "skipped",
    });
    await expect(failing).rejects.toThrow("conflict");

    await expect(
      queue.enqueue({
        queueKey: "theme",
        fileKey: "b",
        revision: queue.claimRevision("b"),
        task: async () => "saved",
        superseded: () => "skipped",
      }),
    ).resolves.toBe("saved");
  });

  it("keeps separate themes out of each other's way", async () => {
    const queue = createThemeFileSaveQueue();
    const blocked = deferred<string>();
    queue.enqueue({
      queueKey: "theme-1",
      fileKey: "a",
      revision: 1,
      task: () => blocked.promise,
      superseded: () => "skipped",
    });

    await expect(
      queue.enqueue({
        queueKey: "theme-2",
        fileKey: "a",
        revision: 1,
        task: async () => "other theme",
        superseded: () => "skipped",
      }),
    ).resolves.toBe("other theme");
    blocked.resolve("done");
  });
});

describe("a save that has been overtaken", () => {
  it("does not run, so older content cannot land last", async () => {
    const queue = createThemeFileSaveQueue();
    const blocked = deferred<string>();
    const saved: string[] = [];

    // Something slow ahead of it, so both later saves wait their turn.
    queue.enqueue({
      queueKey: "theme",
      fileKey: "other",
      revision: queue.claimRevision("other"),
      task: () => blocked.promise,
      superseded: () => "skipped",
    });

    const older = queue.claimRevision("page");
    const newer = queue.claimRevision("page");

    const first = queue.enqueue({
      queueKey: "theme",
      fileKey: "page",
      revision: older,
      task: async () => {
        saved.push("older");
        return "older";
      },
      superseded: () => "superseded",
    });
    const second = queue.enqueue({
      queueKey: "theme",
      fileKey: "page",
      revision: newer,
      task: async () => {
        saved.push("newer");
        return "newer";
      },
      superseded: () => "superseded",
    });

    blocked.resolve("go");
    expect(await first).toBe("superseded");
    expect(await second).toBe("newer");
    expect(saved).toEqual(["newer"]);
  });

  it("still runs the newest one for a file that was edited twice", async () => {
    const queue = createThemeFileSaveQueue();
    const revision = queue.claimRevision("page");

    await expect(
      queue.enqueue({
        queueKey: "theme",
        fileKey: "page",
        revision,
        task: async () => "saved",
        superseded: () => "superseded",
      }),
    ).resolves.toBe("saved");
  });
});

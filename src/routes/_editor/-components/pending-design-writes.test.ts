import { describe, expect, it } from "vitest";
import {
  createPendingDesignWrites,
  type PendingDesignOrigin,
  type PendingDesignSender,
} from "./pending-design-writes";
import { createThemeFileSaveQueue } from "./theme-file-save-queue";

const PATH = "src/routes/guard.tsx";
const DELETE_NOTE: PendingDesignOrigin = {
  kind: "design-element",
  designElement: { kind: "remove-element", targetKey: "17:7" },
};
const SWAP: PendingDesignOrigin = {
  kind: "design-element",
  designElement: {
    kind: "swap-siblings",
    firstKey: "17:7",
    secondKey: "18:7",
  },
};
const plain: PendingDesignSender = { origin: null };

/** A server answer held until the test releases it. */
function deferred() {
  let release!: () => void;
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { answered, release };
}

/**
 * The record's side of one send of a file's text: judge it, claim a
 * revision from the real save queue, record it, and once the (controlled)
 * answer comes, end that send's record. The queue's ordering of sends is
 * not exercised here; its own tests state it.
 */
function send(
  writes: ReturnType<typeof createPendingDesignWrites>,
  queue: ReturnType<typeof createThemeFileSaveQueue>,
  content: string,
  sender: PendingDesignSender,
  server: Promise<void>,
) {
  const verdict = writes.verdict(PATH, content, sender);
  const revision = queue.claimRevision(PATH);
  writes.sent(PATH, content, verdict, revision);
  const done = server.then(() => writes.landed(PATH, revision));
  return { verdict, revision, done };
}

describe("pending Design writes: revision ownership of the shared record", () => {
  it("an older send answered late does not end the record a newer send owns", async () => {
    const writes = createPendingDesignWrites();
    const queue = createThemeFileSaveQueue();
    const first = deferred();
    const second = deferred();

    const older = send(
      writes,
      queue,
      "after delete",
      { origin: DELETE_NOTE },
      first.answered,
    );
    const newer = send(
      writes,
      queue,
      "after swap",
      { origin: SWAP },
      second.answered,
    );
    expect(writes.get(PATH)).toMatchObject({
      origin: SWAP,
      revision: newer.revision,
    });

    first.release();
    await older.done;
    expect(writes.get(PATH)).toMatchObject({
      content: "after swap",
      origin: SWAP,
      revision: newer.revision,
    });
    // The newer write, sent again by a path that names nothing, still goes
    // as itself.
    expect(writes.verdict(PATH, "after swap", plain)).toEqual({
      kind: "operation",
      origin: SWAP,
    });

    second.release();
    await newer.done;
    expect(writes.get(PATH)).toBeUndefined();
  });

  it("a resend of the same text owns the record: the first send answered late leaves it", async () => {
    const writes = createPendingDesignWrites();
    const queue = createThemeFileSaveQueue();
    const first = deferred();
    const resend = deferred();

    const original = send(
      writes,
      queue,
      "after delete",
      { origin: DELETE_NOTE },
      first.answered,
    );
    const again = send(writes, queue, "after delete", plain, resend.answered);
    expect(again.verdict).toEqual({ kind: "operation", origin: DELETE_NOTE });

    first.release();
    await original.done;
    expect(writes.get(PATH)?.revision).toBe(again.revision);

    resend.release();
    await again.done;
    expect(writes.get(PATH)).toBeUndefined();
  });
});

describe("pending Design writes: how a send goes", () => {
  const recorded = () => {
    const writes = createPendingDesignWrites();
    writes.sent(
      PATH,
      "after delete",
      { kind: "operation", origin: DELETE_NOTE },
      1,
    );
    return writes;
  };

  it("no pending write: an ordinary save", () => {
    const writes = createPendingDesignWrites();
    expect(writes.verdict(PATH, "anything", plain)).toEqual({ kind: "plain" });
    expect(
      writes.verdict(PATH, "anything", { origin: null, codeEdit: true }),
    ).toEqual({ kind: "plain" });
  });

  it("the very same text, from any sender but Keep Mine, is the same write", () => {
    const writes = recorded();
    const same = { kind: "operation", origin: DELETE_NOTE };
    expect(writes.verdict(PATH, "after delete", plain)).toEqual(same);
    expect(
      writes.verdict(PATH, "after delete", { origin: null, codeEdit: true }),
    ).toEqual(same);
  });

  it("Keep Mine takes the file over: the same text goes as Code's, and the record ends", () => {
    const writes = recorded();
    const verdict = writes.verdict(PATH, "after delete", {
      origin: null,
      codeOverwrite: true,
    });
    expect(verdict).toEqual({ kind: "code" });
    writes.sent(PATH, "after delete", verdict, 2);
    expect(writes.get(PATH)).toBeUndefined();
  });

  it("the author's own rewrite in Code goes as Code's, and the record ends", () => {
    const writes = recorded();
    const verdict = writes.verdict(PATH, "rewritten in Code", {
      origin: null,
      codeEdit: true,
    });
    expect(verdict).toEqual({ kind: "code" });
    writes.sent(PATH, "rewritten in Code", verdict, 2);
    expect(writes.get(PATH)).toBeUndefined();
  });

  it("other text on top of it from anyone else is held, and the record stays", () => {
    const writes = recorded();
    const verdict = writes.verdict(PATH, "after delete + a style", plain);
    expect(verdict).toMatchObject({
      kind: "held",
      pending: { content: "after delete", origin: DELETE_NOTE },
    });
    expect(writes.get(PATH)?.origin).toEqual(DELETE_NOTE);
  });

  it("the server found holding the text ends the record; other text does not", () => {
    const writes = recorded();
    writes.heldByServer(PATH, "something else");
    expect(writes.get(PATH)).toBeDefined();
    writes.heldByServer(PATH, "after delete");
    expect(writes.get(PATH)).toBeUndefined();
  });
});

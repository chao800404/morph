// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  fenceFor,
  planFencedStart,
  planFencedWrite,
} from "./preview-write-fence";

const HERO = "src/Hero.tsx";
const HELLO = "src/hello.tsx";

describe("planFencedWrite", () => {
  it("writes what differs and records the version it was written as", () => {
    expect(
      planFencedWrite(
        { files: { [HERO]: 3 }, generation: 0 },
        [
          { path: HERO, content: "hero v3 + edit", fence: 3 },
          { path: HELLO, content: "hello", fence: 5 },
        ],
        { [HERO]: "hero v3", [HELLO]: "hello" },
        null,
      ),
    ).toEqual({
      refused: [],
      writes: [{ path: HERO, content: "hero v3 + edit", fence: 3 }],
      unchanged: [HELLO],
      ledger: { files: { [HERO]: 3, [HELLO]: 5 }, readAt: {}, generation: 0 },
    });
  });

  it("refuses the whole write when any file was made from an older version", () => {
    expect(
      planFencedWrite(
        { files: { [HERO]: 4 }, generation: 0 },
        [
          { path: HERO, content: "hero v3 edited by B", fence: 3 },
          { path: HELLO, content: "hello by B", fence: 5 },
        ],
        { [HERO]: "hero v4 by A", [HELLO]: "hello" },
        null,
      ),
    ).toEqual({
      refused: [HERO],
      writes: [],
      unchanged: [],
      ledger: { files: { [HERO]: 4 }, readAt: {}, generation: 0 },
    });
  });

  it("lets two edits of the same version through, the later one winning", () => {
    const plan = planFencedWrite(
      { files: { [HERO]: 4 }, generation: 0 },
      [{ path: HERO, content: "tab B's edit of v4", fence: 4 }],
      { [HERO]: "tab A's edit of v4" },
      null,
    );
    expect(plan.refused).toEqual([]);
    expect(plan.writes).toHaveLength(1);
  });

  it("never lowers what the ledger holds", () => {
    expect(
      planFencedWrite(
        { files: { [HERO]: 6 }, generation: 0 },
        [{ path: HERO, content: "x", fence: 7 }],
        {},
        null,
      ).ledger.files,
    ).toEqual({ [HERO]: 7 });
  });
});

describe("fenceFor", () => {
  it("is the saved version for exactly the saved content", () => {
    expect(
      fenceFor(
        { content: "hero v6", baseVersion: 2 },
        { version: 6, content: "hero v6" },
      ),
    ).toBe(6);
  });

  it("is the version edited from otherwise, and zero for a file never saved", () => {
    expect(
      fenceFor(
        { content: "edit", baseVersion: 5 },
        { version: 6, content: "hero v6" },
      ),
    ).toBe(5);
    expect(fenceFor({ content: "new", baseVersion: null }, undefined)).toBe(0);
  });
});

describe("planFencedStart", () => {
  const ledgerOf = (
    files: Record<string, number>,
    generation = 0,
    readAt: Record<string, number> = {},
  ) => ({ files, readAt, generation });

  it("refuses whole, and records nothing, when any file already holds a newer version", () => {
    expect(
      planFencedStart(ledgerOf({ [HERO]: 4, [HELLO]: 1 }, 7), {
        versions: { [HERO]: 3, [HELLO]: 2 },
        generation: 7,
      }),
    ).toEqual({
      stale: [HERO],
      staleGeneration: false,
      ledger: ledgerOf({ [HERO]: 4, [HELLO]: 1 }, 7),
    });
  });

  it("records its versions and generation, raised and never lowered, when none is older", () => {
    expect(
      planFencedStart(ledgerOf({ [HERO]: 3 }, 5), {
        versions: { [HERO]: 3, [HELLO]: 2 },
        generation: 6,
      }),
    ).toEqual({
      stale: [],
      staleGeneration: false,
      ledger: ledgerOf({ [HERO]: 3, [HELLO]: 2 }, 6, { [HERO]: 6, [HELLO]: 6 }),
    });
  });

  it("refuses a start read at an older generation, though it names no newer file", () => {
    // A newer save created a file this start never heard of: nothing in its
    // versions is older, and only the generation says it was read before.
    expect(
      planFencedStart(ledgerOf({ [HERO]: 3, "src/New.tsx": 1 }, 8), {
        versions: { [HERO]: 3 },
        generation: 7,
      }),
    ).toEqual({
      stale: [],
      staleGeneration: true,
      ledger: ledgerOf({ [HERO]: 3, "src/New.tsx": 1 }, 8),
    });
  });

  it("lets an equal generation through, as an equal version is", () => {
    expect(
      planFencedStart(ledgerOf({ [HERO]: 3 }, 8), {
        versions: { [HERO]: 3 },
        generation: 8,
      }).staleGeneration,
    ).toBe(false);
  });

  it("orders nothing by generation for a start that names none", () => {
    const plan = planFencedStart(ledgerOf({ [HERO]: 3 }, 8), {
      versions: { [HERO]: 3 },
      generation: null,
    });
    expect(plan.staleGeneration).toBe(false);
    expect(plan.ledger.generation).toBe(8);
  });

  // Found in a local E2E run: a file deleted and made again starts over at
  // version 1, and with version 2 laid out every later start was refused.
  it("lays out a lower version of a file read before the start was", () => {
    expect(
      planFencedStart(ledgerOf({ [HERO]: 2 }, 5, { [HERO]: 5 }), {
        versions: { [HERO]: 1 },
        generation: 7,
      }),
    ).toEqual({
      stale: [],
      staleGeneration: false,
      ledger: ledgerOf({ [HERO]: 1 }, 7, { [HERO]: 7 }),
    });
  });

  it("does so though another write already reached the start's generation", () => {
    // The ledger's own generation is no measure of this file: a sync of
    // another file raised it, and the file's version is older than that.
    expect(
      planFencedStart(
        ledgerOf({ [HERO]: 2, [HELLO]: 2 }, 8, { [HERO]: 5, [HELLO]: 8 }),
        { versions: { [HERO]: 1, [HELLO]: 2 }, generation: 8 },
      ).stale,
    ).toEqual([]);
  });

  it("still compares versions where it is not known when one was read", () => {
    expect(
      planFencedStart(ledgerOf({ [HERO]: 2 }, 5), {
        versions: { [HERO]: 1 },
        generation: 7,
      }).stale,
    ).toEqual([HERO]);
  });
});

describe("planFencedWrite across a file deleted and made again", () => {
  const ledger = {
    files: { [HERO]: 2, [HELLO]: 4 },
    readAt: { [HERO]: 5, [HELLO]: 8 },
    generation: 8,
  };

  it("writes a lower version read after the recorded one, and records it", () => {
    const plan = planFencedWrite(
      ledger,
      [{ path: HERO, content: "hero again", fence: 1 }],
      {},
      8,
    );
    expect(plan.refused).toEqual([]);
    expect(plan.ledger).toEqual({
      files: { [HERO]: 1, [HELLO]: 4 },
      readAt: { [HERO]: 8, [HELLO]: 8 },
      generation: 8,
    });
  });

  it("refuses a higher version read before the recorded one", () => {
    // Checked when the deleted file stood at version 5; it is not the file
    // laid out at version 4 since, whatever the numbers say.
    expect(
      planFencedWrite(
        ledger,
        [{ path: HELLO, content: "old hello", fence: 5 }],
        {},
        7,
      ).refused,
    ).toEqual([HELLO]);
  });

  it("lets an equal version read before the recorded one through, as before", () => {
    const plan = planFencedWrite(
      ledger,
      [{ path: HELLO, content: "tab B's edit of v4", fence: 4 }],
      {},
      7,
    );
    expect(plan.refused).toEqual([]);
    // Neither the version nor when it was read goes back.
    expect(plan.ledger.readAt[HELLO]).toBe(8);
    expect(plan.ledger.generation).toBe(8);
  });

  it("orders a write with no generation by version alone, and forgets when the path was read", () => {
    expect(
      planFencedWrite(
        ledger,
        [{ path: HERO, content: "hero again", fence: 1 }],
        {},
        null,
      ).refused,
    ).toEqual([HERO]);
    const plan = planFencedWrite(
      ledger,
      [{ path: HERO, content: "hero v2 edit", fence: 2 }],
      {},
      null,
    );
    expect(plan.refused).toEqual([]);
    expect(plan.ledger.readAt).toEqual({ [HELLO]: 8 });
  });
});

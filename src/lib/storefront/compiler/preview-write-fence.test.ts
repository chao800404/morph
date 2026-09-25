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
        { [HERO]: 3 },
        [
          { path: HERO, content: "hero v3 + edit", fence: 3 },
          { path: HELLO, content: "hello", fence: 5 },
        ],
        { [HERO]: "hero v3", [HELLO]: "hello" },
      ),
    ).toEqual({
      refused: [],
      writes: [{ path: HERO, content: "hero v3 + edit", fence: 3 }],
      unchanged: [HELLO],
      ledger: { [HERO]: 3, [HELLO]: 5 },
    });
  });

  it("refuses the whole write when any file was made from an older version", () => {
    expect(
      planFencedWrite(
        { [HERO]: 4 },
        [
          { path: HERO, content: "hero v3 edited by B", fence: 3 },
          { path: HELLO, content: "hello by B", fence: 5 },
        ],
        { [HERO]: "hero v4 by A", [HELLO]: "hello" },
      ),
    ).toEqual({
      refused: [HERO],
      writes: [],
      unchanged: [],
      ledger: { [HERO]: 4 },
    });
  });

  it("lets two edits of the same version through, the later one winning", () => {
    const plan = planFencedWrite(
      { [HERO]: 4 },
      [{ path: HERO, content: "tab B's edit of v4", fence: 4 }],
      { [HERO]: "tab A's edit of v4" },
    );
    expect(plan.refused).toEqual([]);
    expect(plan.writes).toHaveLength(1);
  });

  it("never lowers what the ledger holds", () => {
    expect(
      planFencedWrite(
        { [HERO]: 6 },
        [{ path: HERO, content: "x", fence: 7 }],
        {},
      ).ledger,
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
  it("refuses whole, and records nothing, when any file already holds a newer version", () => {
    const ledger = { [HERO]: 4, [HELLO]: 1 };
    expect(planFencedStart(ledger, { [HERO]: 3, [HELLO]: 2 })).toEqual({
      stale: [HERO],
      ledger: { [HERO]: 4, [HELLO]: 1 },
    });
  });

  it("records its versions, raised and never lowered, when none is older", () => {
    expect(planFencedStart({ [HERO]: 3 }, { [HERO]: 3, [HELLO]: 2 })).toEqual({
      stale: [],
      ledger: { [HERO]: 3, [HELLO]: 2 },
    });
  });
});

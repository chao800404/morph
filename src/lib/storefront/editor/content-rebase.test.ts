import { describe, expect, it } from "vitest";
import { rebaseContentProps, sameContentValue } from "./content-rebase";

/**
 * The rule two callers share.
 *
 * The Inspector rebases whenever a refetch lands; the content write path has to
 * rebase the same way when a save comes back as an OCC conflict, because what
 * it re-sends must carry whatever the other writer changed. The case that
 * matters is the last one here: an author's key wins without the other
 * writer's keys being lost.
 */

const baseline = { title: "Original", body: "Original body" };

describe("rebasing content onto newer server state", () => {
  it("adopts the server value for a key the author did not touch", () => {
    const rebased = rebaseContentProps({
      baseline,
      local: { title: "Original", body: "Original body" },
      incoming: { title: "Theirs", body: "Original body" },
    });

    expect(rebased).toEqual({ title: "Theirs", body: "Original body" });
  });

  it("keeps a key the author changed", () => {
    const rebased = rebaseContentProps({
      baseline,
      local: { title: "Original", body: "Mine" },
      incoming: { title: "Original", body: "Original body" },
    });

    expect(rebased.body).toBe("Mine");
  });

  it("does not read a refetched copy as a local edit", () => {
    // The refetch is a new object with the same contents. Comparing by
    // reference would make every one of them look like the author's work.
    const rebased = rebaseContentProps({
      baseline,
      local: { title: "Original", body: { rows: ["a", "b"] } },
      incoming: { title: "Original", body: { rows: ["a", "b"] } },
    });

    expect(rebased.body).toEqual({ rows: ["a", "b"] });
  });

  it("carries the other writer's keys through a conflict", () => {
    // The author changed `body` while someone else changed `title` and added
    // `cta`. Re-sending the author's stale snapshot would drop both of those;
    // rebasing first is what makes the re-send safe.
    const rebased = rebaseContentProps({
      baseline,
      local: { title: "Original", body: "Mine" },
      incoming: { title: "Theirs", body: "Their body", cta: "New" },
    });

    expect(rebased).toEqual({
      title: "Theirs",
      body: "Mine",
      cta: "New",
    });
  });

  it("drops a key the server dropped unless the author changed it", () => {
    const dropped = rebaseContentProps({
      baseline: { ...baseline, promo: "old" },
      local: { ...baseline, promo: "old" },
      incoming: { ...baseline },
    });
    expect(dropped).not.toHaveProperty("promo");

    const kept = rebaseContentProps({
      baseline: { ...baseline, promo: "old" },
      local: { ...baseline, promo: "mine" },
      incoming: { ...baseline },
    });
    expect(kept.promo).toBe("mine");
  });
});

describe("comparing stored content", () => {
  it("compares nested arrays and objects by value", () => {
    expect(sameContentValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(
      true,
    );
    expect(sameContentValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(
      false,
    );
    // Key order is not content.
    expect(sameContentValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    // A missing key is not the same as a key holding undefined.
    expect(sameContentValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});

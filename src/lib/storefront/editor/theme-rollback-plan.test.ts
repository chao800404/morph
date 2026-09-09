import { describe, expect, it } from "vitest";
import {
  isThemeRollbackNoop,
  resolveThemeRollbackPlan,
} from "./theme-rollback-plan";

const file = (path: string, content = "x") => ({ path, content });

describe("what a rollback would change", () => {
  it("names a file the revision has and the workspace does not", () => {
    // The reason anyone reaches for rollback: the file was deleted since.
    const plan = resolveThemeRollbackPlan({
      current: [file("src/a.tsx")],
      target: [file("src/a.tsx"), file("src/deleted.tsx")],
    });

    expect(plan.restored).toEqual(["src/deleted.tsx"]);
    expect(plan.removed).toEqual([]);
  });

  it("names a file the workspace has and the revision does not", () => {
    // Work done since the revision. Rollback deletes it, so it has to be said
    // out loud before anyone agrees to one.
    const plan = resolveThemeRollbackPlan({
      current: [file("src/a.tsx"), file("src/new.tsx")],
      target: [file("src/a.tsx")],
    });

    expect(plan.removed).toEqual(["src/new.tsx"]);
    expect(plan.restored).toEqual([]);
  });

  it("separates a changed file from an identical one", () => {
    const plan = resolveThemeRollbackPlan({
      current: [file("src/a.tsx", "new"), file("src/b.tsx", "same")],
      target: [file("src/a.tsx", "old"), file("src/b.tsx", "same")],
    });

    expect(plan.rewritten).toEqual(["src/a.tsx"]);
    expect(plan.unchanged).toEqual(["src/b.tsx"]);
  });

  it("reads in a stable order", () => {
    const plan = resolveThemeRollbackPlan({
      current: [],
      target: [file("src/z.tsx"), file("src/a.tsx"), file("src/m.tsx")],
    });

    expect(plan.restored).toEqual(["src/a.tsx", "src/m.tsx", "src/z.tsx"]);
  });

  it("recognises a rollback that would change nothing", () => {
    const same = [file("src/a.tsx", "same")];

    expect(
      isThemeRollbackNoop(
        resolveThemeRollbackPlan({ current: same, target: same }),
      ),
    ).toBe(true);
    expect(
      isThemeRollbackNoop(
        resolveThemeRollbackPlan({ current: same, target: [] }),
      ),
    ).toBe(false);
  });
});

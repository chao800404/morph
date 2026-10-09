import { describe, expect, it } from "vitest";
import { createConfirmPolicy, describeMassDeletion, INLINE_DELETION_LIMIT } from "./sync-confirm";
import type { CyclePlanSummary } from "./sync-session";

const summary = (remote: number, local = 0): CyclePlanSummary => ({
  uploads: [],
  remoteDeletions: Array.from({ length: remote }, (_, index) => `src/r${index}.ts`),
  downloads: [],
  localDeletions: Array.from({ length: local }, (_, index) => `src/l${index}.ts`),
  conflicts: [],
  binarySkipped: [],
  localSkipped: [],
  massDeletion: `This would delete ${remote} files from the workspace.`,
});

describe("what morph-sync may approve without asking", () => {
  it("lets --allow-mass-delete approve the first mass deletion of a run only", () => {
    const policy = createConfirmPolicy({ yes: true, allowMassDelete: true, interactive: false });
    expect(policy.decide("mass-deletion")).toBe("yes");
    expect(policy.decide("mass-deletion")).toBe("no");
    expect(policy.decide("mass-deletion")).toBe("no");
  });

  it("asks again after the one approval when a person is there", () => {
    const policy = createConfirmPolicy({ yes: false, allowMassDelete: true, interactive: true });
    expect(policy.decide("mass-deletion")).toBe("yes");
    expect(policy.decide("mass-deletion")).toBe("ask");
  });

  it("never lets --yes approve a mass deletion", () => {
    const policy = createConfirmPolicy({ yes: true, allowMassDelete: false, interactive: false });
    expect(policy.decide("startup")).toBe("yes");
    expect(policy.decide("mass-deletion")).toBe("no");
  });

  it("refuses what it cannot ask about", () => {
    const policy = createConfirmPolicy({ yes: false, allowMassDelete: false, interactive: false });
    expect(policy.decide("startup")).toBe("no");
    expect(policy.decide("mass-deletion")).toBe("no");
  });

  it("approves nothing in a dry run, and spends no approval there", () => {
    const policy = createConfirmPolicy({ yes: true, allowMassDelete: true, interactive: true, dryRun: true });
    expect(policy.decide("startup")).toBe("no");
    expect(policy.decide("mass-deletion")).toBe("no");
  });
});

describe("the mass-deletion prompt", () => {
  const base = {
    origin: "http://localhost:3000",
    storefrontId: "store-a",
    themeId: "theme-a",
    folder: "/home/dev/theme",
    listFile: "/home/dev/theme/.morph/pending-deletions.txt",
  };

  it("names the Morph address, store, Theme and folder, and every file", () => {
    const { lines, fileContent } = describeMassDeletion({ ...base, summary: summary(21, 2) });
    const text = lines.join("\n");
    expect(text).toContain("Morph:  http://localhost:3000");
    expect(text).toContain("Store:  store-a");
    expect(text).toContain("Theme:  theme-a");
    expect(text).toContain("Folder: /home/dev/theme");
    expect(text).toContain("21 from Morph, 2 locally");
    for (let index = 0; index < 21; index += 1) {
      expect(text).toContain(`delete from Morph: src/r${index}.ts`);
    }
    expect(text).toContain("delete locally:    src/l1.ts");
    expect(fileContent).toBeNull();
  });

  it("writes a list too long for the screen to a file, in full, and names it", () => {
    const count = INLINE_DELETION_LIMIT + 10;
    const { lines, fileContent } = describeMassDeletion({ ...base, summary: summary(count) });
    expect(lines.join("\n")).toContain(`all ${count} are listed in ${base.listFile}`);
    expect(fileContent!.trim().split("\n")).toHaveLength(count);
    expect(fileContent).toContain(`delete from Morph: src/r${count - 1}.ts`);
  });
});

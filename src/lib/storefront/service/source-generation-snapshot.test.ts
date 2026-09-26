import { describe, expect, it } from "vitest";
import { readAtSourceGeneration } from "./source-generation-snapshot";

/**
 * A theme whose saves advance its generation, and whose files a read sees as
 * they are at that moment.
 */
function theme() {
  const state = { generation: 4, files: "v4" };
  return {
    state,
    save(files: string) {
      state.generation += 1;
      state.files = files;
    },
    readGeneration: async () => state.generation,
  };
}

describe("readAtSourceGeneration", () => {
  it("pairs a read with the generation it was taken at", async () => {
    const t = theme();
    await expect(
      readAtSourceGeneration(t.readGeneration, async () => t.state.files),
    ).resolves.toEqual({ value: "v4", generation: 4 });
  });

  it("never pairs files read before a save with the generation after it", async () => {
    const t = theme();
    let reads = 0;
    const result = await readAtSourceGeneration(t.readGeneration, async () => {
      reads += 1;
      const files = t.state.files;
      // A save lands after the files were read and before the generation is
      // read again: the first read is v4, and the generation is now 5.
      if (reads === 1) t.save("v5");
      return files;
    });

    expect(reads).toBe(2);
    // Taken again, whole: v5 with 5 — not v4 with 5, nor v4 with 4 once the
    // theme had already moved past it.
    expect(result).toEqual({ value: "v5", generation: 5 });
  });

  it("refuses rather than guess when the theme keeps changing", async () => {
    const t = theme();
    await expect(
      readAtSourceGeneration(t.readGeneration, async () => {
        const files = t.state.files;
        t.save(`${files}+`);
        return files;
      }),
    ).rejects.toThrow("SOURCE_GENERATION_UNSTABLE");
  });

  it("refuses a theme that has no generation", async () => {
    await expect(
      readAtSourceGeneration(
        async () => null,
        async () => "files",
      ),
    ).rejects.toThrow("THEME_NOT_FOUND");
  });
});

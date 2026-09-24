import { describe, expect, it } from "vitest";
import { planRollbackBufferReset } from "./rollback-buffers";

describe("planRollbackBufferReset", () => {
  it("resets every copy the editor holds to the restored content", () => {
    expect(
      planRollbackBufferReset({
        restoredFiles: [
          { path: "src/routes/index.tsx", content: "restored index" },
          { path: "src/components/Hero.tsx", content: "restored hero" },
          { path: "src/untouched.ts", content: "never opened" },
        ],
        heldPaths: ["src/routes/index.tsx", "src/components/Hero.tsx"],
      }),
    ).toEqual({
      reset: [
        { path: "src/routes/index.tsx", content: "restored index" },
        { path: "src/components/Hero.tsx", content: "restored hero" },
      ],
      drop: [],
    });
  });

  it("drops a copy of a file the revision does not have", () => {
    expect(
      planRollbackBufferReset({
        restoredFiles: [{ path: "src/routes/index.tsx", content: "x" }],
        heldPaths: ["src/routes/index.tsx", "src/routes/added-later.tsx"],
      }).drop,
    ).toEqual(["src/routes/added-later.tsx"]);
  });

  it("handles a path held both as a draft and as a model once", () => {
    expect(
      planRollbackBufferReset({
        restoredFiles: [{ path: "a.ts", content: "a" }],
        heldPaths: ["a.ts", "a.ts"],
      }).reset,
    ).toEqual([{ path: "a.ts", content: "a" }]);
  });
});

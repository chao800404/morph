import { describe, expect, it } from "vitest";

import {
  inspectorControlSegmentSurface,
  inspectorControlSurface,
} from "./inspector-control-surface";

describe("Inspector control surfaces", () => {
  it("uses the shared token-backed field surface", () => {
    expect(inspectorControlSurface.split(" ")).toEqual(
      expect.arrayContaining([
        "border-input",
        "bg-background",
        "text-foreground",
        "shadow-xs",
        "dark:bg-input/30",
      ]),
    );
  });

  it("keeps unit segments secondary without a native trigger arrow", () => {
    expect(inspectorControlSegmentSurface.split(" ")).toEqual(
      expect.arrayContaining(["bg-muted/40", "text-muted-foreground"]),
    );
  });
});

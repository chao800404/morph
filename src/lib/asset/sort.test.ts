import { describe, expect, it } from "vitest";
import {
  normalizeAssetSorts,
  serializeAssetSorts,
  toggleAssetSort,
} from "./sort";

describe("asset multi-column sorting", () => {
  it("keeps scalar route params backwards compatible", () => {
    expect(normalizeAssetSorts("name", "asc")).toEqual([
      { key: "name", direction: "asc" },
    ]);
  });

  it("preserves the click order when a second field is appended", () => {
    const nameSort = toggleAssetSort(
      normalizeAssetSorts(undefined, undefined),
      "name",
      "asc",
      false,
    );
    const nameThenExtension = toggleAssetSort(
      nameSort,
      "extension",
      "asc",
      true,
    );

    expect(nameThenExtension).toEqual([
      { key: "name", direction: "asc" },
      { key: "extension", direction: "asc" },
    ]);
    expect(serializeAssetSorts(nameThenExtension)).toEqual({
      sortBy: ["name", "extension"],
      sortOrder: ["asc", "asc"],
    });
  });

  it("toggles an existing field without changing its priority", () => {
    const current = normalizeAssetSorts(["name", "extension"], ["asc", "desc"]);

    expect(toggleAssetSort(current, "name", "asc", true)).toEqual([
      { key: "name", direction: "desc" },
      { key: "extension", direction: "desc" },
    ]);
  });
});

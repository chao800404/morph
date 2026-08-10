import { describe, expect, it } from "vitest";
import {
  GLOBAL_SEARCH_AREAS,
  GLOBAL_SEARCH_AREA_OPTIONS,
  GLOBAL_SEARCH_MAX_QUERY_LENGTH,
  toGlobalSearchTerms,
} from "./global-search";

describe("global search contract", () => {
  it("derives every area option from the shared area registry", () => {
    expect(GLOBAL_SEARCH_AREA_OPTIONS.map((option) => option.value)).toEqual(
      GLOBAL_SEARCH_AREAS,
    );
  });

  it("splits cross-field searches into AND terms", () => {
    expect(toGlobalSearchTerms("  p01   red ")).toEqual(["p01", "red"]);
  });

  it("keeps the maximum validated query below D1's binding limit", () => {
    const maximumShortTerms = "a ".repeat(
      Math.ceil(GLOBAL_SEARCH_MAX_QUERY_LENGTH / 2),
    );

    expect(
      toGlobalSearchTerms(
        maximumShortTerms.slice(0, GLOBAL_SEARCH_MAX_QUERY_LENGTH),
      ),
    ).toHaveLength(50);
  });
});

import { describe, expect, it } from "vitest";
import {
  calculatePageForPreservedOffset,
  calculateResponsiveTablePageSize,
} from "./use-responsive-table-page-size";

const options = {
  rowHeight: 48,
  headerHeight: 48,
  fallback: 10,
};

describe("calculateResponsiveTablePageSize", () => {
  it("fills the measured viewport with complete rows", () => {
    expect(calculateResponsiveTablePageSize(768, options)).toBe(15);
    expect(calculateResponsiveTablePageSize(767, options)).toBe(14);
  });

  it("uses the fallback until a measurable height exists", () => {
    expect(calculateResponsiveTablePageSize(0, options)).toBe(10);
  });

  it("keeps at least one data row visible", () => {
    expect(calculateResponsiveTablePageSize(40, options)).toBe(1);
  });
});

describe("calculatePageForPreservedOffset", () => {
  it("keeps the previous first item visible after a resize", () => {
    expect(calculatePageForPreservedOffset(3, 10, 15)).toBe(2);
    expect(calculatePageForPreservedOffset(2, 15, 8)).toBe(2);
  });
});

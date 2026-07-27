import { describe, expect, it } from "vitest";
import {
  D1_MAX_BOUND_PARAMS,
  chunkForInsert,
} from "./d1-batch";

describe("chunkForInsert", () => {
  it("keeps a 32-row, six-column currency insert under D1's limit", () => {
    const rows = Array.from({ length: 32 }, (_, index) => index);
    const groups = chunkForInsert(rows, 6);

    expect(groups.map((group) => group.length)).toEqual([16, 16]);
    expect(
      groups.every(
        (group) => group.length * 6 <= D1_MAX_BOUND_PARAMS,
      ),
    ).toBe(true);
  });
});

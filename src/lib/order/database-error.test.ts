import { describe, expect, it } from "vitest";
import {
  databaseErrorMessage,
  isOrderDisplayIdConflict,
} from "./database-error";

describe("order database errors", () => {
  it("detects display ID conflicts through wrapped database errors", () => {
    const cause = new Error("UNIQUE constraint failed: orders.display_id");
    const error = new Error("D1 batch failed", { cause });

    expect(databaseErrorMessage(error)).toContain("orders.display_id");
    expect(isOrderDisplayIdConflict(error)).toBe(true);
  });

  it("does not classify unrelated constraints as display ID conflicts", () => {
    expect(
      isOrderDisplayIdConflict(
        new Error("UNIQUE constraint failed: orders.id"),
      ),
    ).toBe(false);
  });
});

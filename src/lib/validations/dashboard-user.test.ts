import { describe, expect, it } from "vitest";
import {
  getDashboardUserInputSchema,
  updateDashboardUserInputSchema,
} from "./dashboard-user";

describe("dashboard user IDs", () => {
  it("accepts Better Auth text IDs", () => {
    expect(
      getDashboardUserInputSchema.parse({ id: "better-auth-user-id" }),
    ).toEqual({ id: "better-auth-user-id" });
  });

  it("rejects empty IDs for detail and update operations", () => {
    expect(() => getDashboardUserInputSchema.parse({ id: " " })).toThrow();
    expect(() =>
      updateDashboardUserInputSchema.parse({
        id: "",
        firstName: "Ada",
        lastName: "Lovelace",
      }),
    ).toThrow();
  });
});

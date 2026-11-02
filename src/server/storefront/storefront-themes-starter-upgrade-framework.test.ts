// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Starter upgrade's server functions turn the DAL's framework refusal
 * into THEME_FRAMEWORK_UNAVAILABLE, the code every other framework refusal
 * uses. The real handlers run: `createServerFn` is a stand-in that runs the
 * validator and the handler, as in storefront-theme-pages-framework.test.ts.
 */

const dal = vi.hoisted(() => ({
  reviewStarterUpgrade: vi.fn(),
  applyReviewedStarterUpgrade: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
  type Validator = (data: unknown) => unknown;
  type Handler = (args: {
    data: unknown;
    context: { user: { id: string } };
  }) => unknown;
  function builder(validator: Validator = (data) => data) {
    return {
      validator: (next: Validator) => builder(next),
      middleware: () => builder(validator),
      handler:
        (handler: Handler) =>
        ({ data }: { data: unknown }) =>
          handler({ data: validator(data), context: { user: { id: "u1" } } }),
    };
  }
  return { createServerFn: () => builder() };
});
vi.mock("@tanstack/react-start/server", () => ({ getRequest: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../middleware/auth.middleware", () => ({
  commerceAdminMiddleware: {},
}));
vi.mock("@/lib/storefront/dal/storefront.dal", () => ({
  storefrontDal: dal,
}));

const { reviewStorefrontStarterUpgrade, applyStorefrontStarterUpgrade } =
  await import("./storefront-themes.serverFn");

type Result = { success: boolean; error?: string; message: string };
const call = (fn: unknown, data: unknown) =>
  (fn as (args: { data: unknown }) => Promise<Result>)({ data });

const ids = {
  storefrontId: "00000000-0000-4000-8000-000000000001",
  themeId: "00000000-0000-4000-8000-000000000002",
};
const REASON = "The Starter upgrade is for TanStack Start Themes.";

beforeEach(() => vi.clearAllMocks());

describe("the Starter upgrade server functions on a Theme of another framework", () => {
  it("fails the review with THEME_FRAMEWORK_UNAVAILABLE and the reason", async () => {
    dal.reviewStarterUpgrade.mockResolvedValue({
      unavailable: REASON,
      sourceGeneration: 5,
    });

    const result = await call(reviewStorefrontStarterUpgrade, ids);

    expect(result).toMatchObject({
      success: false,
      error: "THEME_FRAMEWORK_UNAVAILABLE",
      message: REASON,
    });
  });

  it("fails the apply with THEME_FRAMEWORK_UNAVAILABLE and the reason", async () => {
    dal.applyReviewedStarterUpgrade.mockResolvedValue({
      status: "framework-unavailable",
      reason: REASON,
    });

    const result = await call(applyStorefrontStarterUpgrade, {
      ...ids,
      expectedSourceGeneration: 5,
      starterDigest: "a".repeat(64),
    });

    expect(result).toMatchObject({
      success: false,
      error: "THEME_FRAMEWORK_UNAVAILABLE",
      message: REASON,
    });
  });

  it("still offers the plan of a Start Theme", async () => {
    dal.reviewStarterUpgrade.mockResolvedValue({
      unavailable: null,
      sourceGeneration: 5,
      review: { applies: true, digest: "d", changes: [], kept: [] },
      catalog: {
        applies: false,
        kind: null,
        digest: "c",
        changes: [],
        kept: [],
      },
    });

    const result = await call(reviewStorefrontStarterUpgrade, ids);

    expect(result.success).toBe(true);
  });
});

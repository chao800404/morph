// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";

/**
 * `readThemeRouteBindings` (M2 C3) through the real handler and the real
 * `commerceAdminMiddleware`: `createServerFn` is a stand-in that runs the
 * validator, each declared middleware, then the handler (as in
 * storefront-theme-preview-runtime.serverFn.test.ts). Only the session lookup
 * and the DAL are stubbed; the DAL's own ownership and generation checks are
 * tested against SQLite in storefront-theme.dal.astro.test.ts.
 */

const state = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
}));
const dal = vi.hoisted(() => ({ readRouteBindings: vi.fn() }));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  type Validator = (data: unknown) => unknown;
  type Middleware = {
    options: {
      server: (args: {
        next: (options?: { context?: object }) => Promise<unknown>;
        context: object;
      }) => Promise<unknown>;
    };
  };
  type Handler = (args: { data: unknown; context: object }) => unknown;
  function builder(
    validator: Validator = (data) => data,
    middlewares: readonly Middleware[] = [],
  ) {
    return {
      validator: (next: Validator) => builder(next, middlewares),
      middleware: (next: readonly Middleware[]) =>
        builder(validator, [...middlewares, ...next]),
      handler:
        (handler: Handler) =>
        async ({ data }: { data: unknown }) => {
          const validated = validator(data);
          const run = async (
            index: number,
            context: object,
          ): Promise<unknown> =>
            index === middlewares.length
              ? handler({ data: validated, context })
              : middlewares[index]!.options.server({
                  context,
                  next: (options) =>
                    run(index + 1, { ...context, ...options?.context }),
                });
          return run(0, {});
        },
    };
  }
  return { ...actual, createServerFn: () => builder() };
});
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/_serverFn/x"),
}));
vi.mock("../auth/helpers", () => ({
  getAuthWithAdmin: () => ({
    api: { getSession: async () => state.session },
  }),
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/storefront/dal/storefront-theme.dal", () => ({
  storefrontThemeDal: { readRouteBindings: dal.readRouteBindings },
}));

const { readThemeRouteBindings } = await import("./storefront-themes.serverFn");

type Result = {
  success: boolean;
  error?: string;
  message: string;
  data?: unknown;
};
const call = (data: unknown) =>
  (
    readThemeRouteBindings as unknown as (args: {
      data: unknown;
    }) => Promise<Result>
  )({
    data,
  });

async function refusalOf(data: unknown) {
  try {
    await call(data);
    return null;
  } catch (error) {
    return classifyAuthFailure(error);
  }
}

const input = {
  storefrontId: "11111111-1111-4111-8111-111111111111",
  themeId: "22222222-2222-4222-8222-222222222222",
  routePath: "/about",
  expectedSourceGeneration: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { user: { id: "admin-1", role: "admin" } };
});

describe("readThemeRouteBindings", () => {
  it("refuses a caller who is not signed in, before anything is read", async () => {
    state.session = null;
    expect(await refusalOf(input)).toBe("AUTH_REQUIRED");
    expect(dal.readRouteBindings).not.toHaveBeenCalled();
  });

  it("refuses a signed-in account that is not an administrator, before anything is read", async () => {
    state.session = { user: { id: "user-1", role: "user" } };
    expect(await refusalOf(input)).toBe("ACCESS_DENIED");
    expect(dal.readRouteBindings).not.toHaveBeenCalled();
  });

  it("refuses an input without the generation the editor holds", async () => {
    const { expectedSourceGeneration: _omitted, ...blind } = input;
    const result = await call(blind);
    expect(result).toMatchObject({ success: false, error: "INVALID_INPUT" });
    expect(dal.readRouteBindings).not.toHaveBeenCalled();
  });

  it("passes the storefront, Theme, route and generation asked for to the DAL", async () => {
    dal.readRouteBindings.mockResolvedValue({
      status: "view",
      view: {
        routePath: "/about",
        status: { kind: "confirmed" },
        instances: [],
      },
    });
    const result = await call(input);
    expect(dal.readRouteBindings).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({
      success: true,
      data: { routePath: "/about", status: { kind: "confirmed" } },
    });
  });

  it("answers NOT_FOUND for a Theme of another storefront or a deleted one", async () => {
    dal.readRouteBindings.mockResolvedValue({ status: "not-found" });
    expect(await call(input)).toMatchObject({
      success: false,
      error: "NOT_FOUND",
    });
  });

  it("answers ROUTE_BINDINGS_UNAVAILABLE with the reason for a page or Theme it does not read", async () => {
    dal.readRouteBindings.mockResolvedValue({
      status: "unsupported",
      reason: "Route bindings are read for Astro Themes only.",
    });
    expect(await call(input)).toMatchObject({
      success: false,
      error: "ROUTE_BINDINGS_UNAVAILABLE",
      message: "Route bindings are read for Astro Themes only.",
    });
  });

  it("passes a stale view through as an answer, with the generation now stored", async () => {
    const view = {
      routePath: "/about",
      sourceGeneration: 4,
      status: {
        kind: "refused",
        class: "temporarily-unconfirmable",
        reason: "source-stale",
        detail: "changed",
      },
      instances: [],
    };
    dal.readRouteBindings.mockResolvedValue({ status: "view", view });
    expect(await call(input)).toMatchObject({ success: true, data: view });
  });
});

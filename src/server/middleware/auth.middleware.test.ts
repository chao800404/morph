// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; role: string } } | null,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/_serverFn/x"),
}));
vi.mock("../auth/helpers", () => ({
  getAuthWithAdmin: () => ({
    api: { getSession: async () => session.current },
  }),
}));

const { authMiddleware, commerceAdminMiddleware, assetReadMiddleware } =
  await import("./auth.middleware");

type ServerFn = (options: {
  next: (options?: unknown) => Promise<unknown>;
  context: unknown;
}) => Promise<unknown>;
const serverOf = (middleware: unknown) =>
  (middleware as { options: { server: ServerFn } }).options.server;

async function refusalOf(middleware: unknown, context: unknown) {
  const next = vi.fn(async () => "passed");
  try {
    await serverOf(middleware)({ next, context });
    return { code: null, passed: next.mock.calls.length > 0 };
  } catch (error) {
    return { code: classifyAuthFailure(error), passed: false };
  }
}

beforeEach(() => {
  session.current = { user: { id: "user-a", role: "admin" } };
});

describe("the editor's account claim in the auth middlewares", () => {
  for (const [name, middleware] of Object.entries({
    authMiddleware,
    commerceAdminMiddleware,
    assetReadMiddleware,
  })) {
    it(`${name}: refuses a request made for another account`, async () => {
      expect(await refusalOf(middleware, { editorWriter: "user-b" })).toEqual({
        code: "ACCOUNT_CHANGED",
        passed: false,
      });
    });

    it(`${name}: passes a request made for the signed-in account, or with no claim`, async () => {
      expect(await refusalOf(middleware, { editorWriter: "user-a" })).toEqual({
        code: null,
        passed: true,
      });
      expect(await refusalOf(middleware, {})).toEqual({
        code: null,
        passed: true,
      });
    });
  }

  it("still asks for sign-in first, and says another account before a role", async () => {
    session.current = null;
    expect(
      (await refusalOf(commerceAdminMiddleware, { editorWriter: "user-b" }))
        .code,
    ).toBe("AUTH_REQUIRED");

    // Switched to an account that is not an administrator either: what the
    // editor needs to hear is that it is someone else.
    session.current = { user: { id: "user-b", role: "user" } };
    expect(
      (await refusalOf(commerceAdminMiddleware, { editorWriter: "user-a" }))
        .code,
    ).toBe("ACCOUNT_CHANGED");
  });

  it("never lets a claim grant anything", async () => {
    session.current = { user: { id: "user-a", role: "user" } };
    expect(
      (await refusalOf(commerceAdminMiddleware, { editorWriter: "user-a" }))
        .code,
    ).toBe("ACCESS_DENIED");
  });
});

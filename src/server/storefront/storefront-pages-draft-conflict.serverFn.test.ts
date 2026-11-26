// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAGE_DRAFT_CONFLICT,
  PAGE_DRAFT_VERSION_MISMATCH,
} from "@/lib/storefront/page-write-errors";

/**
 * The CMS Page draft writes' server functions (save/publish, metadata,
 * restore): each passes the draft version its caller read to the DAL, is
 * refused without one before any read, and answers a stale draft as
 * `PAGE_DRAFT_CONFLICT`. Any other failure keeps its generic code. The
 * DAL's own concurrency is pinned on real D1 in
 * `storefront-page-occ.integration.test.ts`.
 *
 * `createServerFn` is replaced with a stand-in that runs the validator, the
 * declared middleware (here stubbed to an administrator), then the handler.
 */

const spies = vi.hoisted(() => ({
  activeStorefront: vi.fn(),
  findDetail: vi.fn(),
  handleExists: vi.fn(),
  update: vi.fn(),
  updateMetadata: vi.fn(),
  restoreRevision: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  type Validator = (data: unknown) => unknown;
  type Handler = (args: { data: unknown; context: object }) => unknown;
  function builder(validator: Validator = (data) => data) {
    return {
      validator: (next: Validator) => builder(next),
      middleware: () => builder(validator),
      handler:
        (handler: Handler) =>
        async ({ data }: { data: unknown }) =>
          handler({
            data: validator(data),
            context: { user: { id: "admin-1", role: "admin" } },
          }),
    };
  }
  return { ...actual, createServerFn: () => builder() };
});
vi.mock("../middleware/auth.middleware", () => ({
  commerceAdminMiddleware: {},
  commerceReadMiddleware: {},
}));
vi.mock("@/lib/storefront/dal/storefront-page.dal", () => ({
  storefrontPageDal: spies,
}));

const {
  restoreStorefrontPageRevision,
  updateStorefrontPage,
  updateStorefrontPageMetadata,
} = await import("./storefront-pages.serverFn");

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const PAGE = "44444444-4444-4444-8444-444444444444";
const REVISION = "55555555-5555-4555-8555-555555555555";

type Result = { success: boolean; error?: string; message: string };
const call = (fn: unknown, data: unknown) =>
  (fn as (args: { data: unknown }) => Promise<Result>)({ data });

const cases = [
  {
    name: "updateStorefrontPage",
    fn: () => updateStorefrontPage,
    dal: spies.update,
    input: {
      id: PAGE,
      title: "About",
      handle: "about",
      document: { version: 1, sections: [] },
      publish: true,
      expectedDraftVersion: 3,
    },
    passed: (call: unknown[]) =>
      (call[0] as { expectedDraftVersion: number }).expectedDraftVersion,
  },
  {
    name: "updateStorefrontPageMetadata",
    fn: () => updateStorefrontPageMetadata,
    dal: spies.updateMetadata,
    input: { id: PAGE, metadata: { a: "1" }, expectedDraftVersion: 3 },
    passed: (call: unknown[]) => call[3],
  },
  {
    name: "restoreStorefrontPageRevision",
    fn: () => restoreStorefrontPageRevision,
    dal: spies.restoreRevision,
    input: { id: PAGE, revisionId: REVISION, expectedDraftVersion: 3 },
    passed: (call: unknown[]) =>
      (call[0] as { expectedDraftVersion: number }).expectedDraftVersion,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  spies.activeStorefront.mockResolvedValue({ id: STOREFRONT });
  spies.findDetail.mockResolvedValue({ id: PAGE, version: 3, publishedRevisionId: null });
  spies.handleExists.mockResolvedValue(false);
  spies.update.mockResolvedValue(4);
  spies.updateMetadata.mockResolvedValue({ id: PAGE });
  spies.restoreRevision.mockResolvedValue({ version: 4 });
});

describe.each(cases)("$name", ({ fn, dal, input, passed }) => {
  it("passes the draft version its caller read to the DAL", async () => {
    expect(await call(fn(), input)).toMatchObject({ success: true });
    expect(passed(dal.mock.calls[0]!)).toBe(3);
  });

  it("refuses an input without a draft version, before any read", async () => {
    const { expectedDraftVersion: _omit, ...without } = input;
    expect(await call(fn(), without)).toMatchObject({ success: false });
    expect(spies.activeStorefront).not.toHaveBeenCalled();
    expect(dal).not.toHaveBeenCalled();
  });

  it("answers a stale draft as PAGE_DRAFT_CONFLICT", async () => {
    dal.mockRejectedValue(new Error(`${PAGE_DRAFT_VERSION_MISMATCH}: moved`));
    expect(await call(fn(), input)).toMatchObject({
      success: false,
      error: PAGE_DRAFT_CONFLICT,
    });
  });

  it("keeps any other failure generic", async () => {
    dal.mockRejectedValue(new Error("UNIQUE constraint failed: storefront_pages.handle"));
    const result = await call(fn(), input);
    expect(result.success).toBe(false);
    expect(result.error).not.toBe(PAGE_DRAFT_CONFLICT);
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";
import {
  SECTION_NOT_FOUND,
  TEMPLATE_DRAFT_CONFLICT,
  TEMPLATE_DRAFT_GENERATION_MISMATCH,
} from "@/lib/storefront/theme-write-errors";

/**
 * "Show again" through the real server function handler and the real
 * `commerceAdminMiddleware`: who may call it, which DAL it reaches for each
 * kind of document, with which ownership, and what each DAL answer becomes.
 * The DAL's own behaviour is pinned on real D1 in
 * `section-show-again.integration.test.ts`.
 *
 * `createServerFn` is replaced with a stand-in that runs the validator, then
 * each middleware the function declares, then the handler, as in
 * storefront-theme-preview-server-access.serverFn.test.ts.
 */

const state = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
}));

const spies = vi.hoisted(() => ({
  activeStorefront: vi.fn(),
  showPageSection: vi.fn(),
  showTemplateSection: vi.fn(),
}));

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
vi.mock("@/lib/storefront/dal/storefront-page.dal", () => ({
  storefrontPageDal: {
    activeStorefront: spies.activeStorefront,
    showSectionAgain: spies.showPageSection,
  },
}));
vi.mock("@/lib/storefront/dal/storefront-template-show-again.dal", () => ({
  showTemplateSectionAgain: spies.showTemplateSection,
}));

const { showStorefrontSectionAgain } = await import(
  "./storefront-section-show-again.serverFn"
);

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const THEME = "22222222-2222-4222-8222-222222222222";
const TEMPLATE = "33333333-3333-4333-8333-333333333333";
const PAGE = "44444444-4444-4444-8444-444444444444";

const PAGE_INPUT = {
  kind: "page",
  pageId: PAGE,
  sectionId: "newsletter",
  expectedDraftVersion: 3,
} as const;
const TEMPLATE_INPUT = {
  kind: "template",
  storefrontId: STOREFRONT,
  themeId: THEME,
  templateId: TEMPLATE,
  sectionId: "newsletter",
  expectedDraftGeneration: 7,
} as const;

type Result = {
  success: boolean;
  error?: string;
  message: string;
  data?: unknown;
  errors?: Record<string, string[]>;
};
const call = (data: unknown) =>
  (showStorefrontSectionAgain as unknown as (args: { data: unknown }) => Promise<Result>)({
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

function expectNoDalCall() {
  expect(spies.activeStorefront).not.toHaveBeenCalled();
  expect(spies.showPageSection).not.toHaveBeenCalled();
  expect(spies.showTemplateSection).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { user: { id: "admin-1", role: "admin" } };
  spies.activeStorefront.mockResolvedValue({ id: STOREFRONT });
  spies.showPageSection.mockResolvedValue({ kind: "shown", version: 4 });
  spies.showTemplateSection.mockResolvedValue({
    kind: "shown",
    draftGeneration: 8,
    draftRevisionId: "rev-1",
  });
});

describe.each([
  ["a CMS Page", PAGE_INPUT],
  ["a Theme template", TEMPLATE_INPUT],
] as const)("Show again on %s", (_name, input) => {
  it("refuses a caller who is not signed in, before any read or write", async () => {
    state.session = null;
    expect(await refusalOf(input)).toBe("AUTH_REQUIRED");
    expectNoDalCall();
  });

  it("refuses a signed-in account that is not an administrator, before any read or write", async () => {
    state.session = { user: { id: "user-1", role: "user" } };
    expect(await refusalOf(input)).toBe("ACCESS_DENIED");
    expectNoDalCall();
  });

  it("answers NOT_FOUND when the document is not the storefront's", async () => {
    spies.showPageSection.mockResolvedValue(null);
    spies.showTemplateSection.mockResolvedValue(null);
    expect(await call(input)).toMatchObject({ success: false, error: "NOT_FOUND" });
  });

  it("answers SECTION_NOT_FOUND for a section the draft does not hold", async () => {
    const answer = { kind: "section-not-found", reason: "missing" };
    spies.showPageSection.mockResolvedValue(answer);
    spies.showTemplateSection.mockResolvedValue(answer);
    expect(await call(input)).toMatchObject({
      success: false,
      error: SECTION_NOT_FOUND,
      errors: { reason: ["missing"] },
    });
  });

  it("answers the draft conflict for a stale expected revision", async () => {
    const stale = new Error(`${TEMPLATE_DRAFT_GENERATION_MISMATCH}: moved`);
    spies.showPageSection.mockRejectedValue(stale);
    spies.showTemplateSection.mockRejectedValue(stale);
    expect(await call(input)).toMatchObject({
      success: false,
      error: TEMPLATE_DRAFT_CONFLICT,
    });
  });

  it("answers success with changed: false for a section already shown", async () => {
    spies.showPageSection.mockResolvedValue({ kind: "unchanged", version: 3 });
    spies.showTemplateSection.mockResolvedValue({
      kind: "unchanged",
      draftGeneration: 7,
      draftRevisionId: "rev-1",
    });
    const result = await call(input);
    expect(result).toMatchObject({ success: true, data: { changed: false } });
  });
});

describe("Show again: ownership each kind is written under", () => {
  it("writes a Page under the active storefront and the signed-in author", async () => {
    const result = await call(PAGE_INPUT);
    expect(result).toMatchObject({
      success: true,
      data: { kind: "page", changed: true, version: 4 },
    });
    expect(spies.showPageSection).toHaveBeenCalledWith({
      id: PAGE,
      storefrontId: STOREFRONT,
      sectionId: "newsletter",
      expectedDraftVersion: 3,
      createdBy: "admin-1",
    });
    expect(spies.showTemplateSection).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND for a Page when there is no storefront, without a write", async () => {
    spies.activeStorefront.mockResolvedValue(null);
    expect(await call(PAGE_INPUT)).toMatchObject({ success: false, error: "NOT_FOUND" });
    expect(spies.showPageSection).not.toHaveBeenCalled();
  });

  it("writes a template under the storefront and Theme it names and the signed-in author", async () => {
    const result = await call(TEMPLATE_INPUT);
    expect(result).toMatchObject({
      success: true,
      data: { kind: "template", changed: true, draftGeneration: 8 },
    });
    expect(spies.showTemplateSection).toHaveBeenCalledWith({
      storefrontId: STOREFRONT,
      themeId: THEME,
      templateId: TEMPLATE,
      sectionId: "newsletter",
      expectedDraftGeneration: 7,
      createdBy: "admin-1",
    });
    expect(spies.showPageSection).not.toHaveBeenCalled();
  });

  it("refuses an input without an expected revision, before any read", async () => {
    const { expectedDraftGeneration: _omit, ...noGeneration } = TEMPLATE_INPUT;
    expect(await call(noGeneration)).toMatchObject({ success: false });
    const { expectedDraftVersion: _none, ...noVersion } = PAGE_INPUT;
    expect(await call(noVersion)).toMatchObject({ success: false });
    expectNoDalCall();
  });
});

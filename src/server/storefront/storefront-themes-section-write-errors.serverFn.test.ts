// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How `updateStorefrontThemeSectionProps` answers the DAL's refusals (M2
 * C7): the code is read out of the message (an RPC error keeps only that)
 * and returned as a structured `error`, with the reason code in `errors`.
 * The real handler runs; `createServerFn` is the stand-in of
 * storefront-themes-starter-upgrade-framework.test.ts.
 */

const dal = vi.hoisted(() => ({ updateSectionProps: vi.fn() }));

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
vi.mock("@/lib/storefront/dal/storefront-theme.dal", () => ({
  storefrontThemeDal: dal,
}));

const { updateStorefrontThemeSectionProps } =
  await import("./storefront-themes.serverFn");

type Result = {
  success: boolean;
  error?: string;
  message: string;
  errors?: Record<string, string[]>;
};
const call = (data: unknown) =>
  (
    updateStorefrontThemeSectionProps as unknown as (args: {
      data: unknown;
    }) => Promise<Result>
  )({ data });

const input = {
  storefrontId: "00000000-0000-4000-8000-000000000001",
  themeId: "00000000-0000-4000-8000-000000000002",
  templateId: "00000000-0000-4000-8000-000000000003",
  sectionId: "hero",
  props: { title: "x" },
  expectedDraftGeneration: 1,
  expectedSourceGeneration: 1,
};

beforeEach(() => vi.clearAllMocks());

describe("updateStorefrontThemeSectionProps answers a section-source refusal by its code", () => {
  it("answers SECTION_SOURCE_UNCONFIRMABLE, retryable, with its reason code", async () => {
    dal.updateSectionProps.mockRejectedValue(
      new Error(
        "SECTION_SOURCE_UNCONFIRMABLE: parser-busy: Design cannot confirm this section right now.",
      ),
    );
    expect(await call(input)).toMatchObject({
      success: false,
      error: "SECTION_SOURCE_UNCONFIRMABLE",
      message: "Design cannot confirm this section right now.",
      errors: { reason: ["parser-busy"] },
    });
  });

  it("answers SECTION_SOURCE_UNCONFIRMED with its reason code", async () => {
    dal.updateSectionProps.mockRejectedValue(
      new Error(
        "SECTION_SOURCE_UNCONFIRMED: dynamic-route: Edit it in Code mode.",
      ),
    );
    expect(await call(input)).toMatchObject({
      success: false,
      error: "SECTION_SOURCE_UNCONFIRMED",
      message: "Edit it in Code mode.",
      errors: { reason: ["dynamic-route"] },
    });
  });

  it("answers Start's refusal as before: its text, no reason code", async () => {
    dal.updateSectionProps.mockRejectedValue(
      new Error(
        'SECTION_SOURCE_UNCONFIRMED: src/routes/index.tsx does not render section "hero".',
      ),
    );
    const result = await call(input);
    expect(result).toMatchObject({
      success: false,
      error: "SECTION_SOURCE_UNCONFIRMED",
      message: 'src/routes/index.tsx does not render section "hero".',
    });
    expect(result.errors).toBeUndefined();
  });

  it("still answers a source generation conflict first", async () => {
    dal.updateSectionProps.mockRejectedValue(
      new Error("SELECTION_SOURCE_CONFLICT"),
    );
    expect(await call(input)).toMatchObject({
      success: false,
      error: "SELECTION_SOURCE_CONFLICT",
    });
  });
});

describe("updateStorefrontThemeSectionProps carries an Astro write's identity to the DAL", () => {
  const identity = {
    identity: `0123456789abcdef:2:${"a".repeat(64)}:10:30`,
    componentDigest: "b".repeat(64),
  };

  it("passes the identity and component digest through, for Core to verify", async () => {
    dal.updateSectionProps.mockResolvedValue({ draftGeneration: 2 });
    await call({ ...input, ...identity });
    expect(dal.updateSectionProps).toHaveBeenCalledWith(
      expect.objectContaining(identity),
    );
  });

  it("refuses a component digest that is not a sha256, before the DAL", async () => {
    const result = await call({
      ...input,
      ...identity,
      componentDigest: "B".repeat(64),
    });
    expect(result).toMatchObject({ success: false, error: "INVALID_INPUT" });
    expect(dal.updateSectionProps).not.toHaveBeenCalled();
  });

  it("drops a field it does not know (room for a later presentation token), and verifies nothing from it", async () => {
    dal.updateSectionProps.mockResolvedValue({ draftGeneration: 2 });
    await call({ ...input, presentationToken: "anything" });
    expect(dal.updateSectionProps.mock.calls[0]![0]).not.toHaveProperty(
      "presentationToken",
    );
  });
});

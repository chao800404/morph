// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPublishHiddenSections,
  type PublishHiddenSectionProblem,
} from "@/lib/storefront/content/section-hide-check";

/**
 * How `publishStorefrontThemeTemplate` answers a publish refused for hidden
 * sections (M3 stage 1): the message and code exactly as before, plus the
 * problems as `details`, so the editor can offer "Show again" on each
 * document. Every other failure carries no details. The real handler runs;
 * `createServerFn` is the stand-in of the section-write-errors test.
 */

const dal = vi.hoisted(() => ({ publishTemplate: vi.fn() }));
const releases = vi.hoisted(() => ({
  acquireDeploymentLease: vi.fn(async () => true),
  releaseDeploymentLease: vi.fn(async () => undefined),
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
vi.mock("@/lib/storefront/dal/storefront-theme.dal", () => ({
  PUBLISH_SCOPE_CHANGED: "PUBLISH_SCOPE_CHANGED",
  storefrontThemeDal: dal,
}));
vi.mock("@/lib/storefront/dal/storefront-release.dal", () => ({
  storefrontReleaseDal: releases,
}));

const { publishStorefrontThemeTemplate } =
  await import("./storefront-themes.serverFn");

type Result = {
  success: boolean;
  error?: string;
  message: string;
  details?: unknown;
};
const call = (data: unknown) =>
  (
    publishStorefrontThemeTemplate as unknown as (args: {
      data: unknown;
    }) => Promise<Result>
  )({ data });

const input = {
  storefrontId: "00000000-0000-4000-8000-000000000001",
  themeId: "00000000-0000-4000-8000-000000000002",
  templateId: "00000000-0000-4000-8000-000000000003",
  expectedDraftRevisionId: "00000000-0000-4000-8000-000000000004",
  expectedDraftGeneration: 1,
  expectedReleaseGeneration: 1,
};

/** The error `publishTemplate` raises for these problems. */
function refusal(unsupported: PublishHiddenSectionProblem[]): unknown {
  try {
    assertPublishHiddenSections({ unsupported, rebuild: [] });
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

const pageProblem: PublishHiddenSectionProblem = {
  itemType: "page",
  contentId: "00000000-0000-4000-8000-0000000000aa",
  templateType: "page",
  label: 'the Page "About" (/pages/about)',
  sectionId: "newsletter",
  reason: "no-call-site",
  message: "m",
  refusedAs: "page",
};
const layoutProblem: PublishHiddenSectionProblem = {
  itemType: "template",
  contentId: "00000000-0000-4000-8000-0000000000bb",
  templateType: "layout",
  label: "the layout",
  sectionId: "promo",
  reason: "no-call-site",
  message: "m",
  refusedAs: "unlisted",
};

beforeEach(() => vi.clearAllMocks());

describe("publishStorefrontThemeTemplate answers a hidden-section refusal with its problems as data", () => {
  it("a CMS Page: the code and message as before, the Page and section in details", async () => {
    const error = refusal([pageProblem]) as Error;
    dal.publishTemplate.mockRejectedValue(error);
    const result = await call(input);
    expect(result).toEqual({
      success: false,
      data: null,
      error: "PUBLISH_HIDDEN_SECTION_UNSUPPORTED",
      message: error.message.slice(
        "PUBLISH_HIDDEN_SECTION_UNSUPPORTED: ".length,
      ),
      details: {
        kind: "publish-hidden-sections",
        truncated: false,
        problems: [
          {
            itemType: "page",
            contentId: pageProblem.contentId,
            templateType: "page",
            sectionId: "newsletter",
            reason: "no-call-site",
            refusedAs: "page",
            mustPublish: "page",
            label: pageProblem.label,
          },
        ],
      },
    });
    // The lease is still released.
    expect(releases.releaseDeploymentLease).toHaveBeenCalledTimes(1);
  });

  it("the shared layout: named as a template that only the Theme publish needs", async () => {
    dal.publishTemplate.mockRejectedValue(refusal([layoutProblem]));
    const result = await call(input);
    expect(result).toMatchObject({
      success: false,
      error: "PUBLISH_HIDDEN_SECTION_UNSUPPORTED",
      details: {
        kind: "publish-hidden-sections",
        problems: [
          {
            itemType: "template",
            contentId: layoutProblem.contentId,
            templateType: "layout",
            sectionId: "promo",
            refusedAs: "unlisted",
            mustPublish: "theme",
          },
        ],
      },
    });
  });

  it("a refusal known only by its text (an RPC hop keeps only the message) still answers, without details", async () => {
    const error = refusal([pageProblem]) as Error;
    dal.publishTemplate.mockRejectedValue(new Error(error.message));
    const result = await call(input);
    expect(result.error).toBe("PUBLISH_HIDDEN_SECTION_UNSUPPORTED");
    expect(result.details).toBeUndefined();
  });

  it.each([
    [
      "the rebuild refusal",
      'PUBLISH_HIDE_REBUILD_REQUIRED: This build was made before Morph could hide sections, so it would still show "hero" on the index page (rebuild-required). Rebuild and publish to hide them; the live site is unchanged.',
      "PUBLISH_HIDE_REBUILD_REQUIRED",
    ],
    [
      "a scope change",
      "PUBLISH_SCOPE_CHANGED: The shared layout changed after this publish was confirmed.",
      "PUBLISH_SCOPE_CHANGED",
    ],
    [
      "a build that is not ready",
      "PUBLISH_BUILD_NOT_READY: No succeeded Build Preview is available for this storefront theme.",
      "PUBLISH_BUILD_NOT_READY",
    ],
  ])("%s carries no details", async (_name, message, code) => {
    dal.publishTemplate.mockRejectedValue(new Error(message));
    const result = await call(input);
    expect(result).toMatchObject({ success: false, error: code });
    expect(result).not.toHaveProperty("details");
  });
});

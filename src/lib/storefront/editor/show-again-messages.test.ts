import { describe, expect, it } from "vitest";
import type { PublishHiddenSectionDetail } from "@/lib/storefront/publish-hidden-sections-details";
import {
  isShowAgainDraftConflict,
  showAgainFailureMessage,
  showAgainSuccessMessage,
  storefrontPageEditPath,
} from "./show-again-messages";

const page: PublishHiddenSectionDetail = {
  itemType: "page",
  contentId: "page-1",
  templateType: "page",
  sectionId: "newsletter",
  reason: "no-call-site",
  refusedAs: "page",
  mustPublish: "page",
  label: 'the Page "About" (/pages/about)',
};
const layout: PublishHiddenSectionDetail = {
  itemType: "template",
  contentId: "layout-1",
  templateType: "layout",
  sectionId: "promo",
  reason: "no-call-site",
  refusedAs: "unlisted",
  mustPublish: "theme",
  label: "the layout",
};
const product: PublishHiddenSectionDetail = {
  ...layout,
  contentId: "product-1",
  templateType: "product",
  label: "the product page",
};

describe("showAgainFailureMessage: every Show again error code has its own message", () => {
  it.each([
    ["NOT_FOUND", undefined, /no longer exists/],
    ["SECTION_NOT_FOUND", "missing", /no longer in the draft/],
    ["SECTION_NOT_FOUND", "ambiguous", /more than one section/],
    ["PAGE_DRAFT_CONFLICT", undefined, /changed since Morph read it.*reloaded/],
    ["TEMPLATE_DRAFT_CONFLICT", undefined, /changed since Morph read it.*reloaded/],
    ["SHOW_AGAIN_DOCUMENT_INVALID", undefined, /cannot be read.*Contact support/],
    ["SHOW_AGAIN_VALUE_NOT_PRESERVED", undefined, /without changing other content.*Contact support/],
    ["SECTION_SOURCE_UNCONFIRMED", "section-row-mismatch", /different component/],
    ["SECTION_SOURCE_UNCONFIRMABLE", undefined, /cannot check this section.*right now/],
  ])("%s (%s)", (code, reason, expected) => {
    const message = showAgainFailureMessage({
      success: false,
      data: null,
      message: "server text",
      error: code,
      ...(reason ? { errors: { reason: [reason] } } : {}),
    });
    expect(message).toMatch(expected);
    expect(message).not.toBe("server text");
  });

  it("falls back to the server's own message for any other failure", () => {
    expect(
      showAgainFailureMessage({
        success: false,
        data: null,
        message: "Storefront not found",
        error: "SOMETHING_ELSE",
      }),
    ).toBe("Storefront not found");
  });

  it("names the conflicts as the ones that reload, and nothing else", () => {
    expect(isShowAgainDraftConflict("PAGE_DRAFT_CONFLICT")).toBe(true);
    expect(isShowAgainDraftConflict("TEMPLATE_DRAFT_CONFLICT")).toBe(true);
    expect(isShowAgainDraftConflict("SECTION_NOT_FOUND")).toBe(false);
    expect(isShowAgainDraftConflict(undefined)).toBe(false);
  });
});

describe("showAgainSuccessMessage: what to publish next", () => {
  it("a CMS Page: publish the Page first, then the Theme", () => {
    expect(showAgainSuccessMessage(page, { changed: true, activeTemplateId: "index-1" })).toMatch(
      /Publish the Page first, then publish the Theme again/,
    );
  });

  it("the layout or the page open in the editor: review, then publish again", () => {
    expect(showAgainSuccessMessage(layout, { changed: true, activeTemplateId: "index-1" })).toMatch(
      /Review it, then publish again/,
    );
    expect(
      showAgainSuccessMessage(product, { changed: true, activeTemplateId: "product-1" }),
    ).toMatch(/Review it, then publish again/);
  });

  it("another page's template: publish it from that page", () => {
    expect(
      showAgainSuccessMessage(product, { changed: true, activeTemplateId: "index-1" }),
    ).toMatch(/Open the product page in the editor and publish it/);
  });

  it("says when the section was already shown", () => {
    expect(showAgainSuccessMessage(layout, { changed: false, activeTemplateId: null })).toMatch(
      /^Already shown in the draft\./,
    );
  });
});

describe("storefrontPageEditPath", () => {
  it("is the Dashboard's edit page for that Page", () => {
    expect(storefrontPageEditPath("page-1")).toBe("/dashboard/pages/page-1/edit");
  });
});

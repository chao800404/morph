import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PublishHiddenSectionDetail,
  PublishHiddenSectionsDetails,
} from "@/lib/storefront/publish-hidden-sections-details";
import { EditorPublishHiddenSections } from "./editor-publish-hidden-sections";

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

const refusalOf = (
  problems: PublishHiddenSectionDetail[],
  truncated = false,
): { message: string; details: PublishHiddenSectionsDetails } => ({
  message: "Morph cannot confirm these hidden sections would be left out.",
  details: { kind: "publish-hidden-sections", problems, truncated },
});

function renderRefusal(
  showAgain: (problem: PublishHiddenSectionDetail) => Promise<unknown>,
  refusal = refusalOf([page, layout]),
) {
  const onOpenChange = vi.fn();
  render(
    <EditorPublishHiddenSections
      refusal={refusal}
      activeTemplateId="index-1"
      onOpenChange={onOpenChange}
      showAgain={showAgain as never}
    />,
  );
  return { onOpenChange };
}

const rowOf = (sectionId: string) =>
  screen
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("data-hidden-section-id") === sectionId)!;

describe("EditorPublishHiddenSections", () => {
  it("lists each refused section with its document and a Show again action, and offers no publish", () => {
    renderRefusal(vi.fn());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/left out/)).toBeTruthy();
    expect(within(rowOf("newsletter")).getByText('the Page "About" (/pages/about)')).toBeTruthy();
    expect(within(rowOf("newsletter")).getByText("newsletter")).toBeTruthy();
    expect(within(rowOf("promo")).getByText("the layout")).toBeTruthy();
    expect(within(dialog).getAllByRole("button", { name: "Show again" })).toHaveLength(2);
    expect(within(dialog).queryByRole("button", { name: /publish/i })).toBeNull();
  });

  it("a Page shown again: says to publish the Page first and links to it", async () => {
    const showAgain = vi.fn(async () => ({
      success: true,
      message: "Section shown again",
      data: { kind: "page", changed: true, version: 4 },
    }));
    renderRefusal(showAgain);
    fireEvent.click(within(rowOf("newsletter")).getByRole("button", { name: "Show again" }));
    await waitFor(() =>
      expect(within(rowOf("newsletter")).getByText(/Publish the Page first/)).toBeTruthy(),
    );
    expect(showAgain).toHaveBeenCalledWith(page);
    const link = within(rowOf("newsletter")).getByRole("link", { name: /Open the Page/ });
    expect(link.getAttribute("href")).toBe("/dashboard/pages/page-1/edit");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(rowOf("newsletter")).queryByRole("button", { name: "Show again" })).toBeNull();
  });

  it("a template shown again: review, then publish again", async () => {
    const showAgain = vi.fn(async () => ({
      success: true,
      message: "Section shown again",
      data: { kind: "template", changed: true, draftGeneration: 3 },
    }));
    renderRefusal(showAgain);
    fireEvent.click(within(rowOf("promo")).getByRole("button", { name: "Show again" }));
    await waitFor(() =>
      expect(within(rowOf("promo")).getByText(/Review it, then publish again/)).toBeTruthy(),
    );
    expect(within(rowOf("promo")).queryByRole("link")).toBeNull();
  });

  it("a draft conflict: tells the merchant it was reloaded and leaves the retry to them", async () => {
    const showAgain = vi.fn(async () => ({
      success: false,
      data: null,
      message: "The page was modified concurrently.",
      error: "PAGE_DRAFT_CONFLICT",
    }));
    renderRefusal(showAgain);
    fireEvent.click(within(rowOf("newsletter")).getByRole("button", { name: "Show again" }));
    await waitFor(() =>
      expect(within(rowOf("newsletter")).getByRole("alert").textContent).toMatch(
        /changed since Morph read it.*reloaded/,
      ),
    );
    // Not retried on its own: one call, and the action is offered again.
    expect(showAgain).toHaveBeenCalledTimes(1);
    expect(
      within(rowOf("newsletter")).getByRole("button", { name: "Show again" }),
    ).toBeTruthy();
  });

  it("a refusal: shows its mapped message", async () => {
    const showAgain = vi.fn(async () => ({
      success: false,
      data: null,
      message: "server",
      error: "SHOW_AGAIN_VALUE_NOT_PRESERVED",
    }));
    renderRefusal(showAgain);
    fireEvent.click(within(rowOf("promo")).getByRole("button", { name: "Show again" }));
    await waitFor(() =>
      expect(within(rowOf("promo")).getByRole("alert").textContent).toMatch(
        /without changing other content/,
      ),
    );
  });

  it("a write that throws (writes paused, no answer): says so and offers the action again", async () => {
    const showAgain = vi.fn(async () => {
      throw new Error("Writes are paused while you sign in again.");
    });
    renderRefusal(showAgain);
    fireEvent.click(within(rowOf("promo")).getByRole("button", { name: "Show again" }));
    await waitFor(() =>
      expect(within(rowOf("promo")).getByRole("alert").textContent).toMatch(
        /Writes are paused/,
      ),
    );
    expect(within(rowOf("promo")).getByRole("button", { name: "Show again" })).toBeTruthy();
  });

  it("says when the list is cut short", () => {
    renderRefusal(vi.fn(), refusalOf([page], true));
    expect(screen.getByText(/More hidden sections were not listed/)).toBeTruthy();
  });

  it("closes through its Close button", () => {
    const { onOpenChange } = renderRefusal(vi.fn());
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

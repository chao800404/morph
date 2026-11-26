import type { ServerFailure } from "@/lib/db/server-result";
import type { PublishHiddenSectionDetail } from "@/lib/storefront/publish-hidden-sections-details";

/**
 * What the editor says about one "Show again" (M3 stage 1,
 * `showStorefrontSectionAgain`): one message per answer code, and what the
 * merchant publishes next. Showing a section again never publishes.
 */

/** The two answers that mean "the draft moved since it was read". */
export function isShowAgainDraftConflict(code: string | undefined): boolean {
  return code === "PAGE_DRAFT_CONFLICT" || code === "TEMPLATE_DRAFT_CONFLICT";
}

export function showAgainFailureMessage(result: ServerFailure): string {
  const reason = result.errors?.reason?.[0];
  switch (result.error) {
    case "NOT_FOUND":
      return "This page or template no longer exists. Reload the editor and publish again to see what is still hidden.";
    case "SECTION_NOT_FOUND":
      return reason === "ambiguous"
        ? "The draft holds more than one section with this id, so Morph cannot tell which one to show. Contact support."
        : "This section is no longer in the draft. Publish again to see what is still hidden.";
    case "PAGE_DRAFT_CONFLICT":
    case "TEMPLATE_DRAFT_CONFLICT":
      return "This draft changed since Morph read it, so nothing was changed. It has been reloaded: review it and choose Show again if the section should still be shown.";
    case "SHOW_AGAIN_DOCUMENT_INVALID":
      return "This draft cannot be read, so Morph will not change it. Contact support.";
    case "SHOW_AGAIN_VALUE_NOT_PRESERVED":
      return "Morph cannot show this section again without changing other content in the draft, so nothing was changed. Contact support.";
    case "SECTION_SOURCE_UNCONFIRMED":
      return "This section was saved for a different component than the one the page's code renders now, so Morph will not show it again. Change the code, or contact support.";
    case "SECTION_SOURCE_UNCONFIRMABLE":
      return "Morph cannot check this section against the page's code right now, so nothing was changed. Try again in a moment.";
    default:
      return result.message || "Morph could not show this section again.";
  }
}

/** The Dashboard page where a CMS Page is edited and published. */
export function storefrontPageEditPath(pageId: string): string {
  return `/dashboard/pages/${encodeURIComponent(pageId)}/edit`;
}

export function showAgainSuccessMessage(
  problem: PublishHiddenSectionDetail,
  options: { changed: boolean; activeTemplateId: string | null },
): string {
  const lead = options.changed
    ? "Shown again in the draft."
    : "Already shown in the draft.";
  if (problem.mustPublish === "page") {
    // The Theme publish carries the Page's published revision, not its draft.
    return `${lead} Publish the Page first, then publish the Theme again.`;
  }
  // A Theme publish seals the page open in the editor and the pending
  // layout; another page's template goes live from its own page.
  if (
    problem.templateType === "layout" ||
    problem.contentId === options.activeTemplateId
  ) {
    return `${lead} Review it, then publish again.`;
  }
  return `${lead} Open ${problem.label} in the editor and publish it.`;
}

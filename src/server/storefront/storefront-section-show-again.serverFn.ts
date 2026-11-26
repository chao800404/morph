import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { storefrontPageDal } from "@/lib/storefront/dal/storefront-page.dal";
import { showTemplateSectionAgain } from "@/lib/storefront/dal/storefront-template-show-again.dal";
import {
  SECTION_NOT_FOUND,
  TEMPLATE_DRAFT_CONFLICT,
  TEMPLATE_DRAFT_GENERATION_MISMATCH,
} from "@/lib/storefront/theme-write-errors";
import { showStorefrontSectionAgainInputSchema } from "@/lib/validations/storefront-theme";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

/**
 * "Show again" (M3 stage 1): turns one hidden section of one draft back to
 * shown, for a CMS Page, a Theme template or the shared layout. The way out
 * of a publish refused for a hidden section the build cannot omit; the
 * author reviews the draft and publishes again. Nothing here publishes.
 *
 * Administrators only, as every content write. Answers:
 * - `NOT_FOUND`: the document is not this storefront's (or there is none);
 * - `SECTION_NOT_FOUND`: the draft does not hold that section exactly once,
 *   with `errors.reason` `missing` or `ambiguous`;
 * - `TEMPLATE_DRAFT_CONFLICT`: the draft moved since the caller read it,
 *   the conflict every template write answers (a Page uses it too);
 * - success with `changed: false` for a section already shown, so a retry
 *   after a lost answer reads as done.
 */
export const showStorefrontSectionAgain = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(showStorefrontSectionAgainInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      let result;
      if (data.kind === "page") {
        const storefront = await storefrontPageDal.activeStorefront();
        if (!storefront)
          return fail("Storefront not found", { error: "NOT_FOUND" });
        result = await storefrontPageDal.showSectionAgain({
          id: data.pageId,
          storefrontId: storefront.id,
          sectionId: data.sectionId,
          expectedDraftVersion: data.expectedDraftVersion,
          createdBy: context.user.id,
        });
      } else {
        result = await showTemplateSectionAgain({
          storefrontId: data.storefrontId,
          themeId: data.themeId,
          templateId: data.templateId,
          sectionId: data.sectionId,
          expectedDraftGeneration: data.expectedDraftGeneration,
          createdBy: context.user.id,
        });
      }
      if (!result)
        return fail(
          data.kind === "page" ? "Page not found" : "Theme template not found",
          { error: "NOT_FOUND" },
        );
      if (result.kind === "section-not-found")
        return fail("This section is not in the draft. Reload and try again.", {
          error: SECTION_NOT_FOUND,
          errors: { reason: [result.reason] },
        });
      const { kind, ...token } = result;
      return ok(
        kind === "shown" ? "Section shown again" : "Section is already shown",
        { kind: data.kind, changed: kind === "shown", ...token },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes(TEMPLATE_DRAFT_GENERATION_MISMATCH)) {
        return fail("The draft was modified concurrently.", {
          error: TEMPLATE_DRAFT_CONFLICT,
        });
      }
      return failure(
        "Show storefront section again error",
        error,
        "UPDATE_FAILED",
        "Failed to show the section again",
      );
    }
  });

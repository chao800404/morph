import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fail, ok, parseInput } from "@/lib/db/server-result";
import { idSchema } from "@/lib/validations/commerce";
import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import {
  findLegacyMediaReferences,
  legacyMediaPlaces,
} from "@/lib/storefront/legacy-media-references";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

const checkStorefrontPublishInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
  templateId: idSchema("storefront theme template"),
});

/**
 * What the release about to be published would show visitors as broken.
 *
 * Asked when the publish confirmation opens, so the author sees each place
 * before the release goes live rather than after. Advisory: publishing is
 * not refused, since older content may legitimately still hold such values.
 */
export const checkStorefrontPublishMedia = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(checkStorefrontPublishInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const documents =
        await storefrontContentPublicationDal.listDocumentsForPublish(
          input.data,
        );
      return ok("Publish checked", {
        brokenImages: legacyMediaPlaces(
          documents.map(({ label, document }) => ({
            label,
            references: findLegacyMediaReferences(document),
          })),
        ),
      });
    } catch (error) {
      console.error("Check storefront publish error:", error);
      return fail("Could not check this release's images.", {
        error: "CHECK_FAILED",
      });
    }
  });

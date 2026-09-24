import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import { storefrontReleaseDal } from "@/lib/storefront/dal/storefront-release.dal";
import {
  describeLegacyMediaFindings,
  findLegacyMediaReferences,
} from "@/lib/storefront/legacy-media-references";

/**
 * What a release just made live that visitors will see as a broken image.
 *
 * Read from the release's own publication, so the answer is about exactly
 * what went live — the shell and every page — and not about the draft the
 * author happened to be looking at. Best effort: a publish has already
 * succeeded by the time this runs, and failing to describe it must not turn
 * that into an error.
 */
export async function describeReleaseLegacyMedia(args: {
  storefrontId: string;
  releaseId: string;
}): Promise<string | null> {
  try {
    const release = await storefrontReleaseDal.getById(
      args.storefrontId,
      args.releaseId,
    );
    if (!release?.contentPublicationId) return null;
    const documents =
      await storefrontContentPublicationDal.listPublishedDocumentsWithLabels(
        release.contentPublicationId,
      );
    return describeLegacyMediaFindings(
      documents.map(({ label, document }) => ({
        label,
        references: findLegacyMediaReferences(document),
      })),
    );
  } catch (error) {
    console.warn("Could not check the release for legacy media:", error);
    return null;
  }
}

import { resolveThemeLinksInSlotValues } from "@/lib/storefront/theme-link";
import type { PreviewSectionProps } from "./preview-protocol";

// Editor side only: the preview bridge is copied into a Theme workspace, where
// Morph's own modules do not resolve, so this does not live in preview-protocol.
/**
 * The props a live edit sends the frame: stored links resolved the way
 * published content resolves them (`resolveThemeLinksInSlotValues`), so a
 * component gets the same `rel` in the editor as on the published site. The
 * stored Document is never touched; only the message carries the resolved form.
 *
 * Resolution leaves `undefined` for the parts a link does not have, which the
 * frame refuses as not JSON, so they are dropped here as serialisation drops
 * them in the published response.
 */
export function resolvePreviewSectionLinks(
  props: PreviewSectionProps | undefined,
): PreviewSectionProps | undefined {
  if (!props) return props;
  return JSON.parse(
    JSON.stringify(resolveThemeLinksInSlotValues(props)),
  ) as PreviewSectionProps;
}

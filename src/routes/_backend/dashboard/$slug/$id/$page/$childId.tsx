import { createFileRoute } from "@tanstack/react-router";

/**
 * Gives config-driven child resources a real record segment, for example:
 * `/dashboard/products/:productId/variant/:variantId`.
 *
 * The parent `$page` route owns loading and rendering because the page config
 * is keyed there. This leaf only makes the child record URL addressable.
 */
export const Route = createFileRoute(
  "/_backend/dashboard/$slug/$id/$page/$childId",
)({
  component: () => null,
});

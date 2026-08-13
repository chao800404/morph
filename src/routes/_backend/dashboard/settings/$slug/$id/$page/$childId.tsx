import { createFileRoute } from "@tanstack/react-router";

/**
 * Makes config-driven Settings child resources addressable by record id.
 * The parent `$page` route owns the view and loader; this leaf only provides
 * the stable child segment used by records such as tax rates.
 */
export const Route = createFileRoute(
  "/_backend/dashboard/settings/$slug/$id/$page/$childId",
)({
  component: () => null,
});

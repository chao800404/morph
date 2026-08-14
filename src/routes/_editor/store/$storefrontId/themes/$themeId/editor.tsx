import {
  storefrontThemeEditorSearchSchema,
  type StorefrontThemeEditorSearch,
} from "@/lib/validations/storefront-theme";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { VisualEditorPending } from "../../../../-components/visual-editor-pending";
import { VisualEditorShell } from "../../../../-components/visual-editor-shell";
import { storefrontThemeQueries } from "../../../../-queries/storefront-theme.queries";

export const Route = createFileRoute(
  "/_editor/store/$storefrontId/themes/$themeId/editor",
)({
  validateSearch: storefrontThemeEditorSearchSchema,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      storefrontThemeQueries.detail(params.storefrontId, params.themeId),
    ),
  pendingMs: 0,
  pendingMinMs: 250,
  pendingComponent: VisualEditorPending,
  component: VisualEditorRoute,
});

function VisualEditorRoute() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useQuery(
    storefrontThemeQueries.detail(params.storefrontId, params.themeId),
  );
  const handleSearchChange = useCallback(
    (next: Partial<StorefrontThemeEditorSearch>) =>
      void navigate({
        search: (previous) => ({ ...previous, ...next }),
        replace: true,
      }),
    [navigate],
  );

  if (query.isPending || !query.data) return <VisualEditorPending />;

  const result = query.data;
  if (!result.success) {
    return (
      <div className="flex h-svh items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-component p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Theme editor unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <VisualEditorShell
      context={result.data}
      search={search}
      onSearchChange={handleSearchChange}
    />
  );
}

import {
  storefrontThemeEditorSearchSchema,
  type StorefrontThemeEditorSearch,
} from "@/lib/validations/storefront-theme";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { VisualEditorPending } from "../../../../-components/visual-editor-pending";
import { VisualEditorShell } from "../../../../-components/visual-editor-shell";
import { normalizeEditorTemplateSearch } from "../../../../-components/editor-template";
import { storefrontThemeFileQueries } from "../../../../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../../../../-queries/storefront-theme.queries";

export const Route = createFileRoute(
  "/_editor/store/$storefrontId/themes/$themeId/editor",
)({
  validateSearch: storefrontThemeEditorSearchSchema,
  // Keep shareable editor URLs focused on state that cannot be inferred from
  // the current editor. The search validator still accepts these values, so
  // existing bookmarks continue to work and are canonicalized on entry.
  search: {
    middlewares: [
      stripSearchParams({
        template: "index",
        viewport: "desktop",
        routePath: "/",
      }),
    ],
  },
  loader: async ({ context, params }) => {
    const detailQuery = storefrontThemeQueries.detail(
      params.storefrontId,
      params.themeId,
    );
    const filesQuery = storefrontThemeFileQueries.tree(
      params.storefrontId,
      params.themeId,
    );

    // Context may provision missing catalog routes with OCC. Source must be
    // read after that write, never raced against it or hydrated from old cache.
    const detail = await context.queryClient.ensureQueryData(detailQuery);
    await context.queryClient.fetchQuery(filesQuery).catch(() => undefined);
    return detail;
  },
  pendingMs: 0,
  pendingMinMs: 250,
  pendingComponent: VisualEditorPending,
  component: VisualEditorRoute,
});

function VisualEditorRoute() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const routeContext = Route.useRouteContext();
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

  if (query.isPending) return <VisualEditorPending />;

  if (query.isError || !query.data) {
    return (
      <div className="flex h-svh items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-component p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Theme editor unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The editor request failed. Retry after checking the Theme source or
            server diagnostic.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

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
    <ReadyVisualEditorRoute
      context={result.data}
      search={search}
      onSearchChange={handleSearchChange}
      currentUser={routeContext?.session?.user}
    />
  );
}

function ReadyVisualEditorRoute({
  context,
  search,
  onSearchChange,
  currentUser,
}: {
  context: Parameters<typeof VisualEditorShell>[0]["context"];
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  currentUser: Parameters<typeof VisualEditorShell>[0]["currentUser"];
}) {
  const normalizedSearch = normalizeEditorTemplateSearch(context, search);
  const shouldNormalizeSearch = normalizedSearch !== search;
  const normalizedTemplateId = normalizedSearch.templateId;
  const normalizedTemplateType = normalizedSearch.template;
  const didCanonicalizeSearch = useRef(false);

  useEffect(() => {
    if (!shouldNormalizeSearch) return;
    onSearchChange({
      template: normalizedTemplateType,
      templateId: normalizedTemplateId,
    });
  }, [
    normalizedTemplateId,
    normalizedTemplateType,
    onSearchChange,
    shouldNormalizeSearch,
  ]);

  useEffect(() => {
    if (shouldNormalizeSearch || didCanonicalizeSearch.current) return;
    didCanonicalizeSearch.current = true;
    // The route search middleware removes default-valued keys. Running one
    // replace on entry also shortens legacy links that already contain them.
    onSearchChange({});
  }, [onSearchChange, shouldNormalizeSearch]);

  return (
    <VisualEditorShell
      context={context}
      search={normalizedSearch}
      onSearchChange={onSearchChange}
      currentUser={currentUser}
    />
  );
}

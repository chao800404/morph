import {
  storefrontThemeEditorSearchSchema,
  type StorefrontThemeEditorSearch,
} from "@/lib/validations/storefront-theme";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  stripSearchParams,
  useBlocker,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { classifyEditorNavigation } from "@/lib/storefront/editor/editor-leave-guard";
import {
  resolveEditorRouteView,
  type ThemeReadFailure,
} from "@/lib/storefront/editor/editor-read-lock";
import { VisualEditorPending } from "../../../../-components/visual-editor-pending";
import {
  VisualEditorShell,
  type EditorNavigationGuard,
} from "../../../../-components/visual-editor-shell";
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
  // Where the router is going rather than where it has loaded: `search` keeps
  // the old location until the new one's `beforeLoad` and loader finish, and
  // the router moves this back itself if that navigation fails or is replaced.
  // Leaving the editor, or switching to another page, first sends the edits
  // still waiting out their debounce; the shell decides when it may go (see
  // `createEditorLeaveGuard`). Reloading or closing the tab is the shell's own
  // `beforeunload`, which can only warn.
  const navigationGuardRef = useRef<EditorNavigationGuard | null>(null);
  const shouldBlockNavigation = useCallback(
    ({
      current,
      next,
    }: {
      current: { pathname: string; search: unknown };
      next: { pathname: string; search: unknown };
    }) => {
      const kind = classifyEditorNavigation(
        {
          pathname: current.pathname,
          search: (current.search ?? {}) as Record<string, unknown>,
        },
        {
          pathname: next.pathname,
          search: (next.search ?? {}) as Record<string, unknown>,
        },
      );
      if (!kind) return false;
      return navigationGuardRef.current?.(kind) ?? false;
    },
    [],
  );
  useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: false,
  });
  const navigatingRoutePath = useRouterState({
    select: (state) => {
      const routePath = (state.location.search as { routePath?: unknown })
        .routePath;
      return typeof routePath === "string" && routePath ? routePath : "/";
    },
  });

  // The data last read for this Theme. Once there is some, a read that fails
  // must not take the editor away: the author's unsaved work goes with it.
  // See `resolveEditorRouteView`.
  const themeKey = `${params.storefrontId}/${params.themeId}`;
  const lastLoaded = useRef<{
    key: string;
    context: Parameters<typeof VisualEditorShell>[0]["context"];
  } | null>(null);
  if (query.data?.success) {
    lastLoaded.current = { key: themeKey, context: query.data.data };
  }
  const view = resolveEditorRouteView(
    query,
    lastLoaded.current?.key === themeKey ? lastLoaded.current.context : null,
  );

  if (query.isPending) return <VisualEditorPending />;

  if (view.kind === "ready") {
    return (
      <ReadyVisualEditorRoute
        context={view.context}
        search={search}
        onSearchChange={handleSearchChange}
        navigatingRoutePath={navigatingRoutePath}
        navigationGuardRef={navigationGuardRef}
        currentUser={routeContext?.session?.user}
        themeRead={view.themeRead}
        themeReadSentUnder={view.sentUnder}
        onRetryThemeRead={() => void query.refetch()}
      />
    );
  }

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

  // Never loaded: nothing to keep, so the failure is the page.
  return (
    <div className="flex h-svh items-center justify-center p-6">
      <div className="max-w-md rounded-lg border bg-component p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Theme editor unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {query.data.success ? null : query.data.message}
        </p>
      </div>
    </div>
  );
}

function ReadyVisualEditorRoute({
  context,
  search,
  onSearchChange,
  navigatingRoutePath,
  navigationGuardRef,
  currentUser,
  themeRead,
  themeReadSentUnder,
  onRetryThemeRead,
}: {
  context: Parameters<typeof VisualEditorShell>[0]["context"];
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  navigatingRoutePath: string;
  navigationGuardRef: React.MutableRefObject<EditorNavigationGuard | null>;
  currentUser: Parameters<typeof VisualEditorShell>[0]["currentUser"];
  themeRead: ThemeReadFailure | null;
  themeReadSentUnder: number | undefined;
  onRetryThemeRead: () => void;
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
      navigatingRoutePath={navigatingRoutePath}
      navigationGuardRef={navigationGuardRef}
      currentUser={currentUser}
      themeRead={themeRead}
      themeReadSentUnder={themeReadSentUnder}
      onRetryThemeRead={onRetryThemeRead}
    />
  );
}

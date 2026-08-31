import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ThemeRouteRecord } from "@/lib/storefront/compiler/theme-route-registry";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, RefreshCw, Search } from "lucide-react";
import { memo, useMemo, useState } from "react";
import {
  resolveEditorTemplate,
  resolveEditorTemplateDescriptor,
  templateTypeForRoute,
  toEditorRouteSearch,
  toEditorTemplateSearch,
} from "./editor-template";

type EditorPathNavigatorProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  /** Notify the editor before URL state changes so stale tree rows are hidden. */
  onRouteIntent?: (routePath?: string) => void;
  /** Warm a route before navigation commits. */
  onPrefetchRoute?: (route: ThemeRouteRecord) => void;
  onRefresh: () => void;
  /** Source-derived routes shared with the Pages panel. */
  themeRoutes?: readonly ThemeRouteRecord[];
};

type EditorTemplate = StorefrontThemeEditorDTO["templates"][number];

function routeDisplayName(path: string) {
  if (path === "/") return "Home";
  const segment = path
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/^\$+/, "")
    .replace(/[-_]+/g, " ");
  if (!segment) return path;
  return segment.replace(/\b\w/g, (character) => character.toUpperCase());
}

export const EditorPathNavigator = memo(function EditorPathNavigator({
  context,
  search,
  onSearchChange,
  onRouteIntent,
  onPrefetchRoute,
  onRefresh,
  themeRoutes = [],
}: EditorPathNavigatorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeTemplate = resolveEditorTemplate(context, search);

  // Use the same source-derived route registry as the Pages panel. The
  // template fallback keeps the navigator useful while the source workspace
  // is still being initialized.
  const templateRoutes = useMemo(() => {
    const sourceRoutes = themeRoutes.filter((route) => route.kind === "route");
    if (sourceRoutes.length > 0) {
      return sourceRoutes.map((route) => {
        const template =
          context.templates.find(
            (candidate) => candidate.type === templateTypeForRoute(route.path),
          ) ?? context.templates[0];
        return {
          id: `${route.sourcePath}:${route.path}`,
          template,
          name: routeDisplayName(route.path),
          path: route.path,
          type: template?.type ?? templateTypeForRoute(route.path),
          sourcePath: route.sourcePath,
        };
      });
    }

    return context.templates.map((template) => {
      const isHome = template.type === "index";
      const path = isHome ? "/" : `/${template.type}`;

      return {
        id: template.id,
        template,
        name: isHome ? "Home" : template.name,
        path,
        type: template.type,
        sourcePath: undefined,
      };
    });
  }, [context.templates, themeRoutes]);
  const sourceRoutesByPath = useMemo(
    () => new Map(themeRoutes.map((route) => [route.sourcePath, route])),
    [themeRoutes],
  );

  const activeRouteItem = templateRoutes.find(
    (item) =>
      (search.routePath && item.path === search.routePath) ||
      (!search.routePath && item.template?.id === activeTemplate?.id),
  );
  const descriptor = activeRouteItem
    ? { name: activeRouteItem.name, path: activeRouteItem.path }
    : resolveEditorTemplateDescriptor(activeTemplate);

  // Filtered routes based on search query
  const filteredTemplates = useMemo(() => {
    if (!query.trim()) return templateRoutes;
    const lower = query.toLowerCase().trim();
    return templateRoutes.filter(
      (item) =>
        item.path.toLowerCase().includes(lower) ||
        item.name.toLowerCase().includes(lower) ||
        item.type.toLowerCase().includes(lower) ||
        item.sourcePath?.toLowerCase().includes(lower),
    );
  }, [templateRoutes, query]);

  const handleSelectTemplate = (
    template: EditorTemplate | undefined,
    routePath?: string,
  ) => {
    if (template) {
      onRouteIntent?.(routePath);
      onSearchChange(
        routePath
          ? toEditorRouteSearch(template, routePath)
          : toEditorTemplateSearch(template),
      );
      setOpen(false);
      setQuery("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredTemplates.length > 0) {
        const first = filteredTemplates[0];
        handleSelectTemplate(
          first?.template,
          first?.sourcePath ? first.path : undefined,
        );
      }
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onRefresh();
        }}
        title="Refresh preview"
        aria-label="Refresh preview"
      >
        <RefreshCw className="size-3.5 transition-transform hover:rotate-180" />
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="h-7 min-w-0 max-w-64 items-center gap-1.5 px-2 text-xs leading-none shadow-none"
            aria-label={`Current route: ${descriptor.path}. Click to switch page path.`}
            title="Switch template or page route"
          >
            <span className="truncate font-medium">{descriptor.name}</span>
            <span aria-hidden="true" className="opacity-50">
              ·
            </span>
            <span className="truncate text-muted-foreground">
              {descriptor.path}
            </span>
            <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className="w-72 p-0 overflow-hidden rounded-xl border bg-popover shadow-xl text-popover-foreground"
        >
          {/* Search input header */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search path or page..."
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
              autoFocus
            />
          </div>

          <ScrollArea className="max-h-72 overflow-y-auto p-1.5">
            {/* Source-authored Theme routes */}
            <div className="space-y-0.5">
              {filteredTemplates.map((item) => {
                const isSelected = activeRouteItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => {
                      if (item.sourcePath) {
                        const route = sourceRoutesByPath.get(item.sourcePath);
                        if (route) onPrefetchRoute?.(route);
                      }
                    }}
                    onFocus={() => {
                      if (item.sourcePath) {
                        const route = sourceRoutesByPath.get(item.sourcePath);
                        if (route) onPrefetchRoute?.(route);
                      }
                    }}
                    onClick={() =>
                      handleSelectTemplate(
                        item.template,
                        item.sourcePath ? item.path : undefined,
                      )
                    }
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/10",
                      isSelected &&
                        "bg-accent/70 font-medium text-foreground dark:bg-white/10",
                    )}
                    title={
                      item.sourcePath ? `Open ${item.sourcePath}` : item.path
                    }
                  >
                    <span className="min-w-0 truncate font-medium">
                      {item.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {item.path}
                    </span>
                    {isSelected && (
                      <Check className="size-3.5 text-primary shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
});

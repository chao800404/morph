import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  RefreshCw,
  Search,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import {
  resolveEditorTemplate,
  resolveEditorTemplateDescriptor,
  toEditorTemplateSearch,
} from "./editor-template";

type EditorPathNavigatorProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  onRefresh: () => void;
};

export const EditorPathNavigator = memo(function EditorPathNavigator({
  context,
  search,
  onSearchChange,
  onRefresh,
}: EditorPathNavigatorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeTemplate = resolveEditorTemplate(context, search);
  const descriptor = resolveEditorTemplateDescriptor(activeTemplate);

  // Core template routes
  const templateRoutes = useMemo(() => {
    return context.templates.map((template) => {
      const isHome = template.type === "index";
      const path = isHome
        ? "/ (home)"
        : template.type === "product"
          ? "/product/:id"
          : template.type === "collection"
            ? "/collection/:id"
            : template.type === "blog"
              ? "/blogs/:handle"
              : `/pages/${template.name.toLowerCase()}`;

      return {
        id: template.id,
        template,
        name: isHome ? "Home" : template.name,
        path,
        type: template.type,
      };
    });
  }, [context.templates]);

  // Filtered routes based on search query
  const filteredTemplates = useMemo(() => {
    if (!query.trim()) return templateRoutes;
    const lower = query.toLowerCase().trim();
    return templateRoutes.filter(
      (item) =>
        item.path.toLowerCase().includes(lower) ||
        item.name.toLowerCase().includes(lower) ||
        item.type.toLowerCase().includes(lower),
    );
  }, [templateRoutes, query]);

  const handleSelectTemplate = (template: typeof activeTemplate) => {
    if (template) {
      onSearchChange(toEditorTemplateSearch(template));
      setOpen(false);
      setQuery("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredTemplates.length > 0) {
        handleSelectTemplate(filteredTemplates[0].template);
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="h-7 min-w-0 max-w-64 items-center gap-1.5 px-2 text-xs leading-none shadow-none"
            aria-label={`Current route: ${descriptor.path}. Click to switch page path.`}
            title="Switch template or page route"
          >
            <button
              type="button"
              className="flex size-4 items-center justify-center rounded-xs transition-transform hover:rotate-180"
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              title="Refresh preview"
              aria-label="Refresh preview"
            >
              <RefreshCw className="size-3 text-muted-foreground" />
            </button>
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
      </div>

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
          {/* Main Template Routes */}
          <div className="space-y-0.5">
            {filteredTemplates.map((item) => {
              const isSelected = activeTemplate?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTemplate(item.template)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground dark:hover:bg-white/10",
                    isSelected && "bg-accent/70 font-medium text-foreground dark:bg-white/10",
                  )}
                >
                  <span className="font-mono text-xs">{item.path}</span>
                  {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>

        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
});

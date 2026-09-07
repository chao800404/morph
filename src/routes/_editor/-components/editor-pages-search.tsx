import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import type { ThemeRouteRecord } from "@/lib/storefront/compiler/theme-route-registry";
import {
  FileCode2,
  Search as SearchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

type EditorPagesSearchProps = {
  routes: readonly ThemeRouteRecord[];
  onPrefetchRoute?: (route: ThemeRouteRecord) => void;
  onOpenRoute?: (route: ThemeRouteRecord) => void;
};

export function EditorPagesSearch({
  routes,
  onPrefetchRoute,
  onOpenRoute,
}: EditorPagesSearchProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "k" ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }
      event.preventDefault();
      setOpen((current) => !current);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <div className="border-b border-dashed p-2">
        <SidebarMenuButton
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center justify-between"
          isActive={false}
          aria-label="Search pages"
          title="Search pages (Ctrl+K)"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Search</span>
          </span>
          <Kbd className="bg-transparent opacity-80">Ctrl+K</Kbd>
        </SidebarMenuButton>
      </div>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search pages"
        description="Search Theme pages by route or source file"
        showCloseButton={false}
        className="top-[18%] translate-y-0 sm:max-w-2xl"
      >
        <CommandInput placeholder="Search pages by route or source file…" />
        <CommandList className="max-h-[min(28rem,65vh)]">
          <CommandEmpty>No matching pages</CommandEmpty>
          <CommandGroup heading="Theme pages">
            {routes.map((route) => {
              const label = route.path === "/" ? "Home /" : route.path;
              return (
                <CommandItem
                  key={`${route.sourcePath}:${route.path}`}
                  value={`${label} ${route.path} ${route.sourcePath}`}
                  onMouseEnter={() => onPrefetchRoute?.(route)}
                  onFocus={() => onPrefetchRoute?.(route)}
                  onSelect={() => {
                    onOpenRoute?.(route);
                    setOpen(false);
                  }}
                >
                  <FileCode2 className="size-4" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate">{label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {route.sourcePath}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

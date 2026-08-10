import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { getIconByName } from "@/components/icon-map";
import {
  GLOBAL_SEARCH_DEFAULT_LIMIT,
  GLOBAL_SEARCH_AREA_OPTIONS,
  GLOBAL_SEARCH_LIMIT_INCREMENT,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
  type GlobalSearchArea,
} from "@/lib/search/global-search";
import { cn } from "@/lib/utils";
import { viewPreloader } from "@/lib/config/lazy-view";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { globalSearch } from "@/server/search/global-search.serverFn";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  Boxes,
  CornerDownRight,
  FolderTree,
  Image,
  Package,
  SearchIcon,
  ShoppingCart,
  Tags,
  TicketPercent,
  ChevronDown,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const RESULT_ICONS = {
  product: Package,
  "product-variant": Boxes,
  asset: Image,
  "asset-folder": FolderTree,
  order: ShoppingCart,
  promotion: TicketPercent,
  collection: Boxes,
  category: FolderTree,
  option: Tags,
} as const;

export const DashboardSearch = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<GlobalSearchArea>("all");
  const [limit, setLimit] = useState(GLOBAL_SEARCH_DEFAULT_LIMIT);
  const collectionGroups = useMemo(
    () => getConfig().client.collections.global,
    [],
  );

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [input]);

  const canSearch =
    query.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH && area !== "navigation";
  const { data, isError, isFetching } = useQuery({
    queryKey: ["global-search", area, limit, query],
    queryFn: () => globalSearch({ data: { query, area, limit } }),
    enabled: open && canSearch,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
  const navigationGroups = useMemo(
    () =>
      collectionGroups.map((group) => ({
        title: group.title,
        items: group.collections.flatMap((collection) => [
          {
            title: collection.label || collection.title,
            parent: undefined,
            icon: collection.icon,
            href: `/dashboard/${collection.slug}`,
          },
          ...(collection.items ?? []).map((item) => ({
            title: item.label || item.title,
            parent: collection.label || collection.title,
            icon: undefined,
            href: `/dashboard/${item.slug}`,
          })),
        ]),
      })),
    [collectionGroups],
  );

  const openHref = (href: string) => {
    setOpen(false);
    setInput("");
    setQuery("");
    setArea("all");
    setLimit(GLOBAL_SEARCH_DEFAULT_LIMIT);
    void navigate({ to: href });
  };
  const preloadHref = (href: string) => {
    const pathname = href.split("?")[0];
    const segments = pathname.split("/").filter(Boolean);
    const slug = segments[1];
    if (!slug) return;

    const collection = findCollection(collectionGroups, slug);
    const recordSegment = segments[2];
    const pageSegment = segments[3];
    const view =
      recordSegment === undefined
        ? collection?.index.view
        : recordSegment === "create"
          ? collection?.create?.view
          : recordSegment === "view"
            ? collection?.preview?.view
            : pageSegment === "edit"
              ? collection?.edit?.view
              : pageSegment
                ? collection?.pages?.[pageSegment]?.view
                : collection?.detail?.view;

    void viewPreloader(view)?.();
    void router.preloadRoute({ to: href });
  };
  const preloadHandlers = (href: string) => ({
    onMouseEnter: () => preloadHref(href),
    onFocus: () => preloadHref(href),
    onTouchStart: () => preloadHref(href),
  });
  const reset = () => {
    setInput("");
    setQuery("");
    setArea("all");
    setLimit(GLOBAL_SEARCH_DEFAULT_LIMIT);
  };
  const filteredNavigationGroups = useMemo(() => {
    if (area !== "all" && area !== "navigation") return [];
    const needle = input.trim().toLowerCase();
    return navigationGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.parent ?? ""} ${item.title}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [area, input, navigationGroups]);
  const dynamicGroups = canSearch
    ? (data?.data.groups ?? []).filter(
        (group) => area === "all" || group.area === area,
      )
    : [];
  const showLoading =
    isFetching &&
    dynamicGroups.length === 0 &&
    filteredNavigationGroups.length === 0;

  return (
    <>
      <div className="border-b border-dashed p-2 text-muted-foreground">
        <SidebarMenuButton
          onClick={() => setOpen(true)}
          className="flex items-center justify-between"
          isActive={false}
        >
          <div className="flex flex-1 items-center gap-2">
            <SearchIcon size={14} />
            Search
          </div>
          <Kbd className="bg-transparent opacity-80">Ctrl+K</Kbd>
        </SidebarMenuButton>
      </div>

      <CommandDialog
        className="overflow-hidden p-0 dark:bg-sidebar dark:shadow-elevation-modal sm:max-w-2xl"
        showCloseButton={false}
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) reset();
        }}
        shouldFilter={false}
      >
        <div className="px-3 pt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="cardHeader" size="xs">
                {GLOBAL_SEARCH_AREA_OPTIONS.find((item) => item.value === area)?.label}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={area}
                onValueChange={(value) => {
                  setArea(value as GlobalSearchArea);
                  setLimit(GLOBAL_SEARCH_DEFAULT_LIMIT);
                }}
              >
                {GLOBAL_SEARCH_AREA_OPTIONS.map((item) => (
                  <DropdownMenuRadioItem key={item.value} value={item.value}>
                    {item.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CommandInput
          showSearchIcon={false}
          placeholder="Jump to or find in dashboard..."
          value={input}
          onValueChange={setInput}
          loading={isFetching}
        />
        <ScrollArea className="h-[280px] min-[1281px]:h-[360px]">
          <ScrollBar />
          <CommandList className="relative h-[280px] max-h-none min-[1281px]:h-[360px]">
            {showLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Searching…
              </div>
            ) : isError || data?.success === false ? (
              <div className="py-8 text-center text-sm text-destructive">
                {data?.success === false
                  ? data.message
                  : "Search is temporarily unavailable"}
              </div>
            ) : null}
            {!showLoading && !isError && data?.success !== false
              ? filteredNavigationGroups.map((group) => (
                <CommandGroup
                  className="not-last:border-b"
                  key={group.title}
                  heading={group.title}
                >
                  {group.items.map((item) => {
                    const Icon = item.icon
                      ? getIconByName(item.icon)
                      : Package;
                    return (
                      <CommandItem
                        key={item.href}
                        value={`${item.parent ?? ""} ${item.title}`}
                        onSelect={() => openHref(item.href)}
                        {...preloadHandlers(item.href)}
                      >
                        {item.parent ? (
                          <CornerDownRight className="ml-4 size-4" />
                        ) : (
                          <Icon className="size-4" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate">{item.title}</div>
                          {item.parent ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {item.parent}
                            </div>
                          ) : null}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))
              : null}
            {!showLoading && !isError && data?.success !== false
              ? dynamicGroups.map((group) => (
                <CommandGroup className="not-last:border-b" key={group.area} heading={group.title}>
                  {group.items.map((result) => {
                    const Icon = RESULT_ICONS[result.resource];
                    return (
                      <CommandItem
                        key={`${result.resource}:${result.id}`}
                        value={`${result.title} ${result.subtitle ?? ""}`}
                        onSelect={() => openHref(result.href)}
                        {...preloadHandlers(result.href)}
                      >
                        <Icon className="size-4" />
                        <div className="min-w-0">
                          <div className="truncate">{result.title}</div>
                          {result.subtitle ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {result.subtitle}
                            </div>
                          ) : null}
                        </div>
                      </CommandItem>
                    );
                  })}
                  {group.hasMore && area === "all" ? (
                    <CommandItem
                      value={`${group.area}:show-more`}
                      keywords={[query]}
                      onSelect={() => {
                        setArea(group.area);
                        setLimit(GLOBAL_SEARCH_DEFAULT_LIMIT);
                      }}
                    >
                      <Plus className="size-4" />
                      Show more
                    </CommandItem>
                  ) : null}
                  {group.hasMore && area === group.area ? (
                    <CommandItem
                      value={`${group.area}:load-more`}
                      keywords={[query]}
                      onSelect={() =>
                        setLimit((current) => current + GLOBAL_SEARCH_LIMIT_INCREMENT)
                      }
                    >
                      <Plus className="size-4" />
                      Load {Math.min(GLOBAL_SEARCH_LIMIT_INCREMENT, group.count - limit)} more
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              ))
              : null}
            {!showLoading &&
            !isError &&
            data?.success !== false &&
            filteredNavigationGroups.length === 0 &&
            dynamicGroups.length === 0 ? (
              <CommandEmpty className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
                No results found.
              </CommandEmpty>
            ) : null}
          </CommandList>
        </ScrollArea>

        <DialogFooter
          className={cn(
            "items-center rounded-b-lg bg-secondary px-4 py-3 text-xs text-muted-foreground shadow-none dark:bg-component",
            "sm:justify-end dark:shadow-elevation-modal max-lg:hidden",
          )}
        >
          Navigation <Kbd className="border bg-white dark:bg-sidebar">↓</Kbd>
          <Kbd className="border bg-white dark:bg-sidebar">↑</Kbd>
          <span className="px-1 opacity-30">|</span>
          Open result <Kbd className="border bg-white dark:bg-sidebar">↵</Kbd>
        </DialogFooter>
      </CommandDialog>
    </>
  );
};

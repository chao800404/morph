import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DialogFooter } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const defaultItems = [
  {
    title: "Global",
    items: [
      {
        name: "Calendar",
        slug: "",
      },
      {
        name: "Search Emoji",
        slug: "",
      },
      {
        name: "Calculator",
        slug: "",
      },
    ],
  },
  {
    title: "Settings",
    items: [
      {
        name: "Profile",
        slug: "",
      },
      {
        name: "Billing",
        slug: "",
      },
      {
        name: "Settings",
        slug: "",
      },
      {
        name: "Notifications",
        slug: "",
      },
      {
        name: "Integrations",
        slug: "",
      },
      {
        name: "API",
        slug: "",
      },
    ],
  },
];

export const DashboardSearch = () => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: index,
    name: `Item ${index + 1}`,
  }));

  const handleClear = () => {
    inputRef.current?.focus();
    setSearch("");
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key?.toLocaleLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <>
      <div className="p-2 border-b border-dashed text-muted-foreground">
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
        className="sm:max-w-2xl overflow-hidden  dark:bg-sidebar p-0 dark:shadow-elevation-modal"
        showCloseButton={false}
        open={open}
        onOpenChange={setOpen}
      >
        <CommandInput
          showSearchIcon={false}
          placeholder="Jump to or find in dashboard..."
        />
        <ScrollArea className="h-[300px]">
          <ScrollBar />
          <CommandList className="max-h-none">
            <CommandEmpty>No results found.</CommandEmpty>
            {defaultItems.map((item) => (
              <CommandGroup
                className="not-last:border-b"
                key={item.title}
                heading={item.title}
              >
                {item.items.map((item) => (
                  <CommandItem key={item.name}>{item.name}</CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </ScrollArea>

        <DialogFooter
          className={cn(
            "text-xs shadow-none rounded-b-lg text-muted-foreground items-center bg-secondary dark:bg-component px-4 py-3",
            "sm:justify-end",
            "dark:shadow-elevation-modal",
            "max-lg:hidden",
          )}
        >
          Navigation
          <Kbd className="bg-white border dark:bg-sidebar">↓</Kbd>
          <Kbd className="bg-white border dark:bg-sidebar">↑</Kbd>
          <span className="px-1 opacity-30">|</span>
          Open result <Kbd className="bg-white border dark:bg-sidebar">↵</Kbd>
        </DialogFooter>
      </CommandDialog>
    </>
  );
};

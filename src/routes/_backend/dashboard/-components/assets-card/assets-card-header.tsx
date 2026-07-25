"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BarsArrowDownIcon } from "@/components/ui/icons/bars-arrow-down-icon";
import FilePlusCornerIcon from "@/components/ui/icons/file-plus-corner-icon";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { cn } from "@/lib/utils";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import type { AssetsCardData } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-card.types";
import { getAssetsDialogConfig } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-dialog.config";
import { createItems } from "@/server/asset/create-items.serverFn";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Dot, FolderPlus, Search, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";

export const AssetsCardHeader = ({
  data,
  uploadConfig,
  id,
  className,
}: {
  id?: string;
  className?: string;
  data?: AssetsCardData;
  uploadConfig: {
    maxFileSize: number;
    minFiles: number;
    maxFiles: number;
    allowedTypes: string[];
    allowedExtensions: string[];
  };
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const query = search.q || "";
  const sortBy = search.sortBy || "createdAt";
  const sortOrder = search.sortOrder || "desc";
  const [isInputFocused, setIsInputFocused] = useState(false);

  // State to track IME composition
  const [isComposing, setIsComposing] = useState(false);

  // Patch the shared dashboard search params without knowing which dynamic
  // route is mounted, so `to: "."` keeps the current path.
  const patchSearch = useCallback(
    (patch: Partial<DashboardSearch>) => {
      navigate({
        to: ".",
        search: (prev: DashboardSearch) => ({ ...prev, ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  // Debounced search handler
  const debouncedSearch = useDebouncedCallback((value: string) => {
    patchSearch({ q: value || undefined });
  }, 800);

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!isComposing) {
      debouncedSearch(value);
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (
    e: React.CompositionEvent<HTMLInputElement>,
  ) => {
    setIsComposing(false);
    // Trigger search immediately after composition ends
    debouncedSearch(e.currentTarget.value);
  };

  // Clear search input
  const handleClearInput = () => {
    patchSearch({ q: undefined });
  };

  // Handle sort change
  const handleSortChange = (
    newSortBy: NonNullable<DashboardSearch["sortBy"]>,
    newSortOrder: NonNullable<DashboardSearch["sortOrder"]>,
  ) => {
    patchSearch({ sortBy: newSortBy, sortOrder: newSortOrder });
  };

  // Sort options configuration
  const sortOptions: Array<{
    value: "name" | "createdAt" | "updatedAt";
    label: string;
  }> = [
    { value: "name", label: "Name" },
    { value: "createdAt", label: "Created" },
    { value: "updatedAt", label: "Updated" },
  ];

  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreateFolder = () => {
    const config = getAssetsDialogConfig("folder", uploadConfig);
    const currentFolderId = data?.currentFolder?.id;

    // Pre-fill parent-id if we are in a folder
    const fields = config.fields.map((field) => {
      if (field.name === "parent-id" && currentFolderId) {
        return { ...field, defaultValue: String(currentFolderId) };
      }
      return field;
    });

    setCreateData({
      title: config.title,
      description: config.description,
      fields: fields,
      action: createItems,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
    });
    setCreateOpen(true);
  };

  const handleCreateAssets = () => {
    const config = getAssetsDialogConfig("assets", uploadConfig);
    const currentFolderId = data?.currentFolder?.id;

    // Pre-fill parent-id if we are in a folder
    const fields = config.fields.map((field) => {
      if (field.name === "parent-id" && currentFolderId) {
        return { ...field, defaultValue: String(currentFolderId) };
      }
      return field;
    });

    setCreateData({
      title: config.title,
      description: config.description,
      fields: fields,
      action: createItems,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
    });
    setCreateOpen(true);
  };

  return (
    <div id={id} className={cn("flex items-center gap-2", className)}>
      <InputGroup
        className={cn("w-52", "max-md:flex-1 max-md:w-full")}
        variant="cardHeader"
        size="xs"
      >
        <InputGroupAddon>
          <Search className="size-4" />
        </InputGroupAddon>

        <InputGroupInput
          autoFocus={query.length > 0 || isInputFocused}
          key={query || "empty"}
          id="query-input"
          className="py-0 bg-transparent placeholder:text-zinc-500 text-zinc-300 max-md:w-full"
          placeholder="Search"
          defaultValue={query || ""}
          onChange={handleSearchChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
        />
        {query && (
          <InputGroupAddon
            align="inline-end"
            className="cursor-pointer"
            onClick={handleClearInput}
          >
            <X className="size-4 text-destructive" />
          </InputGroupAddon>
        )}
      </InputGroup>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="text-primary"
            type="button"
            variant="cardHeader"
            size="xs"
          >
            <BarsArrowDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {sortOptions.map((option) => {
            const isActive = sortBy === option.value;
            const newOrder = isActive && sortOrder === "asc" ? "desc" : "asc";

            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => handleSortChange(option.value, newOrder)}
              >
                <Dot
                  className={cn(
                    "opacity-0 size-5 text-muted-foreground",
                    isActive && "opacity-100",
                  )}
                />
                {option.label}
                {isActive && (
                  <Kbd>
                    {sortOrder === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )}
                  </Kbd>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="form" size="xs">
            Create
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleCreateFolder}>
            <FolderPlus className="size-4" />
            folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateAssets}>
            <FilePlusCornerIcon className="size-4" />
            assets
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

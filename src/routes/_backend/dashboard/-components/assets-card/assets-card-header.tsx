"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FilePlusCornerIcon from "@/components/ui/icons/file-plus-corner-icon";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { AssetCreateVariant } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/asset-create.config";
import { cn } from "@/lib/utils";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";

export const AssetsCardHeader = ({
  id,
  className,
}: {
  id?: string;
  className?: string;
}) => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;

  // Creating is a route, so the current folder rides along in the URL and the
  // create page is linkable.
  const openCreate = (variant: AssetCreateVariant) =>
    void navigate({
      to: "/dashboard/$slug/create",
      params: { slug: "assets" },
      search: { ...search, variant },
    });

  return (
    <div id={id} className={cn("flex items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="form" size="xs">
            Create
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => openCreate("folder")}>
            <FolderPlus className="size-4" />
            folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openCreate("upload")}>
            <FilePlusCornerIcon className="size-4" />
            assets
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

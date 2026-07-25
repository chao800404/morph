"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FolderSelectFieldRenderProps } from "@/components/upload/types";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { cn } from "@/lib/utils";
import { assetQueries } from "@/routes/_backend/dashboard/-queries/asset.queries";
import { useAssetEditStore } from "@/routes/_backend/dashboard/-views/features/asset/edit/use-asset-edit-store";
import { useAssetMoveStore } from "@/routes/_backend/dashboard/-views/features/asset/move/use-asset-move-store";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Folder } from "lucide-react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  children?: FolderNode[];
}

interface FolderOption {
  value: string;
  label: string;
  level: number;
  children?: FolderOption[];
}

export const FolderSelectField = ({
  field,
  fieldId,
  initialValue,
  onChange,
  className,
}: FolderSelectFieldRenderProps) => {
  const { excludedIds: editExcludedIds } = useAssetEditStore(
    useShallow((state) => ({
      excludedIds: state.excludedIds,
    })),
  );

  const { excludedIds: moveExcludedIds } = useAssetMoveStore(
    useShallow((state) => ({
      excludedIds: state.excludedIds,
    })),
  );

  const search = useSearch({ strict: false });
  const folderId = (search as DashboardSearch)?.folderId;

  const { data: result, isLoading: loading } = useQuery(assetQueries.folders());

  const folderOptions = useMemo(() => {
    if (!result?.success || !result.data) return [];

    const allExcludedIds = new Set<string>();
    if (field.excludedIds)
      field.excludedIds.forEach((id) => allExcludedIds.add(id));
    if (editExcludedIds)
      editExcludedIds.forEach((id) => allExcludedIds.add(id));
    if (moveExcludedIds)
      moveExcludedIds.forEach((id) => allExcludedIds.add(id));

    // Convert flat list to tree
    const newFolderMap = new Map<string, FolderNode>();
    const rootFolders: FolderNode[] = [];

    result.data.forEach((folder) => {
      newFolderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        children: [],
      });
    });

    newFolderMap.forEach((node) => {
      if (node.parentId && newFolderMap.has(node.parentId)) {
        newFolderMap.get(node.parentId)!.children?.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    // Filter and Sort
    const filterAndSort = (nodes: FolderNode[]): FolderNode[] => {
      return nodes
        .filter((node) => !allExcludedIds.has(node.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((node) => ({
          ...node,
          children: node.children ? filterAndSort(node.children) : undefined,
        }));
    };

    const filteredAndSorted = filterAndSort(rootFolders);

    // Convert to Options
    const convertToOptions = (
      nodes: FolderNode[],
      level: number = 0,
    ): FolderOption[] => {
      return nodes.map((node) => ({
        value: node.id,
        label: node.name,
        level,
        children:
          node.children && node.children.length > 0
            ? convertToOptions(node.children, level + 1)
            : undefined,
      }));
    };

    const rootOption: FolderOption = {
      value: "root",
      label: "Root",
      level: 0,
    };

    return [rootOption, ...convertToOptions(filteredAndSorted, 1)];
  }, [result, field.excludedIds, editExcludedIds, moveExcludedIds]);

  const defaultFolderId = useMemo(() => {
    if (!result?.data) return "root";

    const nameToIdMap = new Map<string, string>();
    const allIds = new Set<string>();
    result.data.forEach((f) => {
      nameToIdMap.set(f.name, f.id);
      allIds.add(f.id);
    });

    if (folderId && allIds.has(folderId)) return folderId;
    if (initialValue) {
      if (allIds.has(initialValue)) return initialValue;
      const foundId = nameToIdMap.get(initialValue);
      if (foundId) return foundId;
      const partialMatch = result.data.find(
        (f) => f.name.toLowerCase() === initialValue.toLowerCase(),
      );
      if (partialMatch) return partialMatch.id;
    }
    return folderId || "root";
  }, [folderId, initialValue, result]);

  const renderFolderOptions = (options: FolderOption[]) => {
    return options.map((option) => (
      <div key={option.value}>
        <SelectItem value={option.value} className="py-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground/70" />
            <span className="truncate text-sm">{option.label}</span>
          </div>
        </SelectItem>
        {option.children && option.children.length > 0 && (
          <div className="border-l ml-4 pl-2">
            {renderFolderOptions(option.children)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <Select
      name={field.name}
      defaultValue={defaultFolderId}
      onValueChange={onChange}
      disabled={field.disabled || loading}
      required={field.required}
    >
      <SelectTrigger
        id={fieldId}
        className={cn("w-full", field.inputClassName, className)}
      >
        <SelectValue
          placeholder={loading ? "Loading folders..." : field.placeholder}
        />
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        {folderOptions.length > 0 && renderFolderOptions(folderOptions)}
      </SelectContent>
    </Select>
  );
};

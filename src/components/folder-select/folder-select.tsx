"use client";

import type { FolderSelectFieldRenderProps } from "@/components/upload/types";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useAssetMoveStore } from "@/lib/asset/store/use-asset-move-store";
import { useSearch } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { RemoteSelectField } from "@/components/form/remote-select-field";

export const FolderSelectField = ({
  field,
  initialValue,
  onChange,
  className,
}: FolderSelectFieldRenderProps) => {
  const { excludedIds: moveExcludedIds } = useAssetMoveStore(
    useShallow((state) => ({ excludedIds: state.excludedIds })),
  );
  const search = useSearch({ strict: false }) as DashboardSearch;
  const value = initialValue || search.folderId || "root";
  const excludedIds = [
    ...(field.excludedIds ?? []),
    ...(moveExcludedIds ?? []),
  ];

  return (
    <RemoteSelectField
      field={{
        ...field,
        type: "remote-select",
        remoteSource: "asset-folders",
        componentClassName: className,
        excludedIds,
      }}
      value={value}
      onChange={onChange}
    />
  );
};

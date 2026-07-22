"use client";

import { useNavigate } from "@tanstack/react-router";
import { CardPagination } from "../card-pagination/card-pagination";

type Props = {
  pagination?: {
    page: number;
    limit: number;
    totalAssets: number;
    totalPages: number;
  };
};

export const AssetFooter = ({ pagination }: Props) => {
  const navigate = useNavigate();

  const handlePageChange = (action: "first" | "prev" | "next" | "last") => {
    if (!pagination) return;
    const { page, totalPages } = pagination;
    let newPage = page;

    switch (action) {
      case "first":
        newPage = 1;
        break;
      case "prev":
        newPage = Math.max(1, page - 1);
        break;
      case "next":
        newPage = Math.min(totalPages, page + 1);
        break;
      case "last":
        newPage = totalPages;
        break;
    }

    navigate({
      search: (prev: any) => ({ ...prev, page: newPage }),
      replace: true,
    } as any);
  };

  if (!pagination) return null;

  const startItem = (pagination.page - 1) * pagination.limit + 1;
  const endItem = Math.min(
    pagination.page * pagination.limit,
    pagination.totalAssets,
  );

  return (
    <div className="px-6 py-4 text-sm border-t">
      <CardPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        itemsLength={pagination.totalAssets}
        startItem={startItem}
        endItem={endItem}
        onPageChange={handlePageChange}
      />
    </div>
  );
};

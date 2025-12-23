import { useMemo, useState } from "react";

export interface PaginationResult<T> {
  totalPages: number;
  paginatedItems: T[];
  startItem: number;
  endItem: number;
  itemsLength: number;
  currentPage: number;
}

export function paginate<T>(
  items: T[],
  page: number,
  perPage: number,
): PaginationResult<T> {
  const safePerPage = Math.max(1, perPage);
  const itemsLength = items.length;
  const totalPages = Math.max(1, Math.ceil(itemsLength / safePerPage));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * safePerPage;
  const endIndex = startIndex + safePerPage;
  const paginatedItems = items.slice(startIndex, endIndex);
  const startItem = itemsLength > 0 ? startIndex + 1 : 0;
  const endItem = Math.min(endIndex, itemsLength);

  return {
    totalPages,
    paginatedItems,
    startItem,
    endItem,
    itemsLength,
    currentPage,
  };
}

export function usePagination<T>(items: T[], perPage: number) {
  const [page, setPage] = useState(1);

  const data = useMemo(
    () => paginate(items, page, perPage),
    [items, page, perPage],
  );

  const next = () =>
    setPage((prev) => (prev < data.totalPages ? prev + 1 : data.totalPages));
  const prev = () => setPage((prev) => (prev > 1 ? prev - 1 : 1));
  const go = (p: number) =>
    setPage(() => (p < 1 ? 1 : p > data.totalPages ? data.totalPages : p));

  return { page, setPage, next, prev, go, data } as const;
}

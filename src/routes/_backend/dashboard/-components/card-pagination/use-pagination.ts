import { paginate } from "@/lib/config/pagination";
import { useEffect, useMemo, useState } from "react";

interface UsePaginationProps<T> {
  items: T[];
  itemsPerPage?: number;
}

export const usePagination = <T>({
  items,
  itemsPerPage = 10,
}: UsePaginationProps<T>) => {
  const [page, setPage] = useState(1);

  // Calculate pagination data
  const paginationData = useMemo(
    () => paginate(items, page, itemsPerPage),
    [items, page, itemsPerPage],
  );

  // Auto-adjust page if out of range
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [items.length, page, itemsPerPage]);

  const handlePageChange = (action: "first" | "prev" | "next" | "last") => {
    setPage((prev) => {
      const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
      switch (action) {
        case "first":
          return 1;
        case "prev":
          return prev > 1 ? prev - 1 : 1;
        case "next":
          return prev < totalPages ? prev + 1 : totalPages;
        case "last":
          return totalPages;
        default:
          return prev;
      }
    });
  };

  return {
    page,
    setPage,
    paginationData,
    handlePageChange,
    totalPages: Math.max(1, Math.ceil(items.length / itemsPerPage)),
  };
};

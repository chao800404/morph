import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface CardPaginationProps {
  page: number;
  totalPages: number;
  itemsLength: number;
  startItem?: number;
  endItem?: number;
  layout?: "inline" | "stacked";
  onPageChange: (action: "first" | "prev" | "next" | "last") => void;
}

export const CardPagination = ({
  page,
  totalPages,
  itemsLength,
  startItem,
  endItem,
  layout = "inline",
  onPageChange,
}: CardPaginationProps) => {
  const displayStart = startItem ?? 1;
  const displayEnd = endItem ?? itemsLength;
  const isStacked = layout === "stacked";

  return (
    <Pagination
      data-pagination-layout={layout}
      className={cn(
        isStacked
          ? "flex-col items-stretch justify-start gap-2"
          : "items-center justify-between",
      )}
    >
      {/*
        A count, not a list of pages. It was a `ul` holding two `div`s, which
        is invalid list markup and reads to a screen reader as a list with no
        items in it.
      */}
      <div
        className={cn(
          "flex flex-row items-center gap-1",
          isStacked
            ? "w-full justify-between gap-3 text-xs"
            : "flex-1 justify-between",
        )}
      >
        <div
          className={cn(isStacked ? "min-w-0 truncate" : "whitespace-nowrap")}
        >
          {`${displayStart} - ${displayEnd} of ${itemsLength} Results`}
        </div>
        <div className={cn(isStacked ? "shrink-0" : "mr-5")}>
          {`${page} of ${totalPages} Pages`}
        </div>
      </div>
      <PaginationContent
        className={cn("w-fit gap-1", isStacked ? "ml-auto" : "justify-between")}
      >
        <PaginationItem>
          <Button
            onClick={() => onPageChange("first")}
            variant="formDark"
            size="xs"
            disabled={page === 1}
            title="First page"
          >
            <ChevronFirst />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <Button
            onClick={() => onPageChange("prev")}
            variant="formDark"
            size="xs"
            disabled={page === 1}
            title="Previous page"
          >
            <ChevronLeft />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <Button
            onClick={() => onPageChange("next")}
            variant="formDark"
            size="xs"
            disabled={page === totalPages}
            title="Next page"
          >
            <ChevronRight />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <Button
            onClick={() => onPageChange("last")}
            variant="formDark"
            size="xs"
            disabled={page === totalPages}
            title="Last page"
          >
            <ChevronLast />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
};

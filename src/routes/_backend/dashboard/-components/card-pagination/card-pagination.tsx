import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent } from "@/components/ui/pagination";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";

interface CardPaginationProps {
    page: number;
    totalPages: number;
    itemsLength: number;
    startItem?: number;
    endItem?: number;
    onPageChange: (action: "first" | "prev" | "next" | "last") => void;
}

export const CardPagination = ({
    page,
    totalPages,
    itemsLength,
    startItem,
    endItem,
    onPageChange,
}: CardPaginationProps) => {
    const displayStart = startItem ?? 1;
    const displayEnd = endItem ?? itemsLength;

    return (
        <Pagination className="flex justify-between items-center">
            <PaginationContent className="flex flex-1 justify-between items-center">
                <div>{`${displayStart} - ${displayEnd} of ${itemsLength} Results`}</div>
                <div className="mr-5">{`${page} of ${totalPages} Pages`}</div>
            </PaginationContent>
            <PaginationContent className="flex justify-between items-center w-fit gap-1">
                <Button
                    onClick={() => onPageChange("first")}
                    variant="formDark"
                    size="xs"
                    disabled={page === 1}
                    title="First page"
                >
                    <ChevronFirst />
                </Button>
                <Button
                    onClick={() => onPageChange("prev")}
                    variant="formDark"
                    size="xs"
                    disabled={page === 1}
                    title="Previous page"
                >
                    <ChevronLeft />
                </Button>
                <Button
                    onClick={() => onPageChange("next")}
                    variant="formDark"
                    size="xs"
                    disabled={page === totalPages}
                    title="Next page"
                >
                    <ChevronRight />
                </Button>
                <Button
                    onClick={() => onPageChange("last")}
                    variant="formDark"
                    size="xs"
                    disabled={page === totalPages}
                    title="Last page"
                >
                    <ChevronLast />
                </Button>
            </PaginationContent>
        </Pagination>
    );
};

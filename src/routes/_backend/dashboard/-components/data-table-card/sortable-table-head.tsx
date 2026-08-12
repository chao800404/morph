import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/react/sortable";
import type { ReactNode } from "react";

export const SortableTableHead = ({
  id,
  index,
  className,
  children,
  disabled,
}: {
  id: string;
  index: number;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
}) => {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    disabled,
  });

  return (
    <TableHead
      ref={ref}
      className={cn(
        !disabled && "cursor-grab select-none active:cursor-grabbing",
        isDragging && "opacity-50",
        className,
      )}
    >
      <div ref={handleRef} className="flex h-full items-center">
        {children}
      </div>
    </TableHead>
  );
};

import { AssetBlockMap } from "@/components/asset/asset-block-map";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn, formatBytes, getFileType } from "@/lib/utils";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import { useDraggable } from "@dnd-kit/react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import { Ellipsis } from "lucide-react";
import { memo, useMemo } from "react";
import { ItemActionsMenu } from "./item-actions-menu";

type Props = {
  name: string;
  id: string;
  checked: boolean;
  isDraggableEnabled: boolean;
  type: string | null;
  url: string;
  createdAt: string;
  onCheckedChange: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string) => void;
  onClick?: (id: string) => void;
  onDownload?: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  onCopyURL?: (id: string) => void;
  onKeyDown?: (
    id: string,
    event: React.KeyboardEvent<HTMLTableRowElement>,
  ) => void;
  extension?: string;
  size: number;
  updatedAt?: string;
};

export const AssetTableRow = memo(function AssetTableRow({
  name,
  id,
  checked,
  isDraggableEnabled,
  url,
  createdAt,
  type,
  onCheckedChange,
  onDelete,
  onEdit,
  onMove,
  onClick,
  onDownload,
  onDoubleClick,
  onCopyURL,
  onKeyDown,
  extension,
  size,
  updatedAt,
}: Props) {
  const { isItemDragging, setActionMenuOpen } =
    useAssetsStore(
      useShallow((state) => ({
        isItemDragging: state.isItemDragging(id, "asset"),
        setActionMenuOpen: state.setActionMenuOpen,
      })),
    );
  const dragData = useMemo(() => ({ name }), [name]);
  const { ref, isDragging: isDraggableDragging } = useDraggable({
    id,
    type: "asset",
    data: dragData,
    disabled: !isDraggableEnabled,
  });
  const isDragging = isDraggableDragging || isItemDragging;

  return (
    <TableRow
      onDoubleClick={() => onDoubleClick?.(id)}
      ref={ref}
      id={id}
      data-type="asset-asset"
      data-dragging={isDragging}
      data-selected={checked}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          onCheckedChange(id);
          return;
        }
        if (onClick) {
          e.preventDefault();
          e.stopPropagation();
          onClick(id);
        }
      }}
      className={cn(
        "h-12 cursor-pointer group relative z-20 select-none",
        "data-[dragging=true]:opacity-20",
        "data-[selected=true]:bg-blue-100/50 dark:data-[selected=true]:bg-zinc-700",
      )}
      onKeyDown={(event) => onKeyDown?.(id, event)}
    >
      <TableCell
        className={cn(
          "pl-6 sticky left-0",
          "group-data-[scrolled=true]:bg-component",
          'after:content-[""] after:opacity-0 after:absolute after:top-0 after:left-0 after:right-0 after:bottom-0 after:border-r after:border-border',
          "group-data-[scrolled=true]:after:opacity-100",
        )}
      >
        <div className="flex gap-2 pr-3 items-center h-full justify-center relative z-30">
          <Checkbox
            onDoubleClick={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onCheckedChange(id);
            }}
            checked={checked}
          />
          <div className="w-6 flex justify-start">
            <AssetBlockMap
              variant="sm"
              type="asset"
              name={name}
              src={url}
              alt={name}
              fileType={getFileType(type)}
              extension={extension}
            />
          </div>
        </div>
      </TableCell>
      <TableCell className="font-medium truncate max-w-64 max-2xl:max-w-40">
        {name}
      </TableCell>
      <TableCell className="whitespace-nowrap uppercase text-muted-foreground">
        {extension}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatBytes(size)}
      </TableCell>
      <TableCell
        suppressHydrationWarning
        className="whitespace-nowrap text-muted-foreground"
      >
        {createdAt}
      </TableCell>
      <TableCell
        suppressHydrationWarning
        className="whitespace-nowrap text-muted-foreground"
      >
        {updatedAt || createdAt}
      </TableCell>

      <ItemActionsMenu
        isDragging={isDragging}
        onCopyURL={() => onCopyURL?.(id)}
        onEdit={() => onEdit(id)}
        onDelete={() => onDelete(id)}
        onDownload={() => onDownload?.(id)}
        onMove={() => onMove(id)}
        type="asset"
        onOpenChange={(open) => {
          setActionMenuOpen(open);
        }}
      >
        <TableCell
          className={cn(
            "text-center w-12 px-4 sticky top-0 right-0 bg-component",
            "group-data-[scrolled=true]:bg-component",
            'after:content-[""] after:opacity-0 after:absolute after:top-0 after:left-0 after:right-0 after:bottom-0 after:border-l after:border-border after:pointer-events-none',
            "group-data-[scrolled=true]:after:opacity-100",
            "max-md:px-2",
            "group-data-[selected=true]:bg-blue-100/50 dark:group-data-[selected=true]:bg-zinc-700",
          )}
        >
          <Button className="p-0 h-fit" variant="none">
            <Ellipsis className="size-4 text-muted-foreground" />
          </Button>
        </TableCell>
      </ItemActionsMenu>
    </TableRow>
  );
});

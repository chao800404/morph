import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoveFolderIcon } from "@/components/ui/icons/move-folder-icon";
import { Download, Edit2, Link, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  align?: "center" | "start" | "end";
  type: "folder" | "asset";
  isDragging?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  onCopyURL?: () => void;
  onDownload?: () => void;
  onMove?: () => void;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

/**
 * Unified dropdown menu for both folder and asset items
 * Provides actions like Edit, Move, Download, Copy URL (assets only), and Delete
 */
export const ItemActionsMenu = ({
  align = "end",
  type,
  isDragging,
  onDelete,
  onCopyURL,
  onEdit,
  onDownload,
  onMove,
  onOpenChange,
  children,
}: Props) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    if (isDragging) {
      setIsDropdownOpen(false);
    }
  }, [isDragging]);

  const handleOpenChange = (open: boolean) => {
    setIsDropdownOpen(open);
    onOpenChange?.(open);
  };

  return (
    <>
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="z-10000">
          {onEdit && (
            <DropdownMenuItem onClick={onEdit}>
              <Edit2 />
              Edit
            </DropdownMenuItem>
          )}
          {onMove && (
            <DropdownMenuItem onClick={onMove}>
              <MoveFolderIcon />
              Move
            </DropdownMenuItem>
          )}
          {onDownload && (
            <DropdownMenuItem onClick={onDownload}>
              <Download />
              Download
            </DropdownMenuItem>
          )}
          {type === "asset" && onCopyURL && (
            <DropdownMenuItem onClick={onCopyURL}>
              <Link />
              Copy URL
            </DropdownMenuItem>
          )}
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

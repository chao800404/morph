"use client";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface DialogHeaderActionsProps {
  onClose?: () => void;
  /**
   * If provided, renders in the center of the header.
   */
  title?: ReactNode;
  /**
   * Additional actions to render on the right side.
   */
  actions?: ReactNode;
  className?: string;
}

export const DialogHeaderActions = ({
  onClose,
  title,
  actions,
  className,
}: DialogHeaderActionsProps) => {
  return (
    <DialogHeader
      className={cn(
        "dark:shadow-elevation-modal-header overflow-hidden h-fit border-b-[0.5px] border-ring/20 px-4 py-2 rounded-t-lg relative z-30",
        "dark:border-none",
        title || actions
          ? "grid grid-cols-3 flex-row items-center"
          : "flex flex-col",
        className,
      )}
    >
      <DialogTitle className="flex whitespace-nowrap justify-center gap-2 text-sm text-muted-foreground">
        {title}
      </DialogTitle>

      {/* Center Content */}

      {/* Right Actions */}
      {actions && <div className="flex justify-end gap-2">{actions}</div>}
    </DialogHeader>
  );
};

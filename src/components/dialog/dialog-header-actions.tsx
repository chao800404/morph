"use client";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { createSurface } from "./create-surface";

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
  onClose: _onClose,
  title,
  actions,
  className,
}: DialogHeaderActionsProps) => {
  return (
    <DialogHeader
      className={cn(
        createSurface.header,
        createSurface.headerPadding,
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

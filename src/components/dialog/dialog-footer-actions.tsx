"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SheetClose, SheetFooter } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ChevronUp } from "lucide-react";
import { ReactNode } from "react";

export interface SubmitAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

interface DialogFooterActionsProps {
  isLoading?: boolean;
  isDisabled?: boolean;
  onCancel?: () => void;
  onSubmit?: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  loadingLabel?: string;
  className?: string;
  showCancel?: boolean;
  isSheet?: boolean; // If true, wraps in SheetFooter and uses SheetClose
  additionalActions?: SubmitAction[]; // Additional submit actions for dropdown
}

export const DialogFooterActions = ({
  isLoading = false,
  isDisabled = false,
  onCancel,
  onSubmit,
  cancelLabel = "Cancel",
  submitLabel = "Save",
  loadingLabel = "Saving...",
  className,
  showCancel = true,
  isSheet = true,
  additionalActions,
}: DialogFooterActionsProps) => {
  const hasAdditionalActions =
    additionalActions && additionalActions.length > 0;

  const SubmitButton = hasAdditionalActions ? (
    <ButtonGroup>
      <Button
        disabled={isLoading || isDisabled}
        variant="form"
        type={onSubmit ? "button" : "submit"}
        onClick={onSubmit}
        className="rounded-r-none"
      >
        {isLoading ? loadingLabel : submitLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={isLoading || isDisabled}
            variant="form"
            size="xs"
            className="rounded-l-none border-l px-0"
            type="button"
          >
            <ChevronUp className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-fit shadow-xs/20 border">
          {additionalActions.map((action, index) => (
            <DropdownMenuItem key={index} onClick={action.onClick}>
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  ) : (
    <Button
      disabled={isLoading || isDisabled}
      variant="form"
      type={onSubmit ? "button" : "submit"}
      onClick={onSubmit}
    >
      {isLoading ? loadingLabel : submitLabel}
    </Button>
  );

  const Content = (
    <div className={cn("flex items-center gap-2 ml-auto", className)}>
      {showCancel &&
        (isSheet ? (
          <SheetClose asChild>
            <Button
              disabled={isLoading}
              variant="formDark"
              type="button"
              onClick={(e) => {
                if (onCancel) {
                  e.preventDefault();
                  onCancel();
                }
              }}
            >
              {cancelLabel}
            </Button>
          </SheetClose>
        ) : (
          <Button
            disabled={isLoading}
            variant="formDark"
            type="button"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
        ))}
      {SubmitButton}
    </div>
  );

  if (isSheet) {
    return <SheetFooter className="px-4">{Content}</SheetFooter>;
  }

  return Content;
};

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";

export interface CommandBarAction {
  id?: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onAction: () => void;
  disabled?: boolean;
  destructive?: boolean;
  iconOnly?: boolean;
}

interface CommandBarProps {
  open: boolean;
  value: ReactNode;
  actions?: readonly CommandBarAction[];
  primaryAction?: CommandBarAction;
  onClear?: () => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Shared bottom command bar for batch table actions.
 *
 * Feature code supplies selection state and commands; this primitive owns the
 * floating surface, motion, action layout, tooltips, keyboard hints and
 * interaction states.
 */
export const CommandBar = ({
  open,
  value,
  actions = [],
  primaryAction,
  onClear,
  ariaLabel = "Selection actions",
  className,
}: CommandBarProps) => {
  useEffect(() => {
    if (!open) return;

    const shortcuts = [...actions, primaryAction].filter(
      (action): action is CommandBarAction => Boolean(action?.shortcut),
    );
    if (shortcuts.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target =
        event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      ) {
        return;
      }

      const action = shortcuts.find(
        (item) =>
          item.shortcut?.toLocaleLowerCase() ===
          event.key.toLocaleLowerCase(),
      );
      if (!action || action.disabled) return;

      event.preventDefault();
      action.onAction();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, open, primaryAction]);

  const renderAction = (
    action: CommandBarAction,
    primary = false,
  ) => {
    const button = (
      <Button
        type="button"
        aria-label={action.label}
        variant={primary ? "form" : "ghost"}
        size={action.iconOnly ? "icon" : "sm"}
        rounded="full"
        disabled={action.disabled}
        className={cn(
          "text-xs",
          !primary &&
            action.destructive &&
            "text-destructive hover:text-destructive",
        )}
        onClick={action.onAction}
      >
        {action.icon}
        {action.iconOnly ? null : action.label}
        {!action.iconOnly && action.shortcut ? (
          <Kbd>{action.shortcut}</Kbd>
        ) : null}
      </Button>
    );

    if (!action.iconOnly) return button;

    return (
      <Tooltip key={action.id ?? action.label}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <span className="flex items-center gap-2">
            {action.label}
            {action.shortcut ? <Kbd>{action.shortcut}</Kbd> : null}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="command-bar"
          role="toolbar"
          aria-label={ariaLabel}
          initial={{ opacity: 0, y: 24, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, y: 24, x: "-50%" }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className={cn(
            "fixed bottom-4 left-1/2 z-50 flex min-h-11 items-center overflow-hidden rounded-full border border-border bg-popover px-2 text-xs text-muted-foreground shadow-lg",
            className,
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            rounded="full"
            disabled={!onClear}
            className="text-xs"
            onClick={onClear}
          >
            {value}
          </Button>

          {actions.length > 0 || primaryAction ? (
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          ) : null}

          {actions.length > 0 ? (
            <div className="flex items-center gap-0.5">
              {actions.map((action) => (
                <span key={action.id ?? action.label}>
                  {renderAction(action)}
                </span>
              ))}
            </div>
          ) : null}

          {actions.length > 0 && primaryAction ? (
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          ) : null}

          {primaryAction ? renderAction(primaryAction, true) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

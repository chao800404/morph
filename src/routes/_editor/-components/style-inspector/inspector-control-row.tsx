import { Slot } from "@radix-ui/react-slot";
import type {
  ComponentPropsWithoutRef,
  ElementType,
  ReactElement,
  ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { inspectorControlSurface } from "./inspector-control-surface";

export const inspectorControlRowClassName = cn(
  inspectorControlSurface,
  "group/control-row flex h-8 w-full min-w-0 items-center gap-1 overflow-hidden px-2",
  "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
);

type InspectorControlRowOwnProps<T extends ElementType> = {
  as?: T;
  label: ReactNode;
  control: ReactElement;
  unit?: ReactNode;
  trailingAction?: ReactNode;
  flushTrailing?: boolean;
  className?: string;
};

export type InspectorControlRowProps<T extends ElementType = "div"> =
  InspectorControlRowOwnProps<T> &
    Omit<
      ComponentPropsWithoutRef<T>,
      keyof InspectorControlRowOwnProps<T> | "children"
    >;

export function InspectorControlRow<T extends ElementType = "div">({
  as,
  label,
  control,
  unit,
  trailingAction,
  flushTrailing = false,
  className,
  ...props
}: InspectorControlRowProps<T>) {
  const Component = as ?? "div";

  return (
    <Component
      data-slot="inspector-control-row"
      className={cn(
        inspectorControlRowClassName,
        (unit || trailingAction || flushTrailing) && "pr-0",
        className,
      )}
      {...props}
    >
      <span
        data-slot="inspector-control-row-label"
        className="min-w-4 shrink-0 text-xs text-muted-foreground"
      >
        {label}
      </span>
      <Slot
        data-inspector-control-row-slot="control"
        className="ml-auto flex min-w-0 flex-1 items-center justify-end"
      >
        {control}
      </Slot>
      {unit ? (
        <span
          data-slot="inspector-control-row-unit"
          className="flex min-w-0 shrink-0 items-center self-stretch"
        >
          {unit}
        </span>
      ) : null}
      {trailingAction ? (
        <span
          data-slot="inspector-control-row-action"
          className="flex min-w-0 shrink-0 items-center self-stretch"
        >
          {trailingAction}
        </span>
      ) : null}
    </Component>
  );
}

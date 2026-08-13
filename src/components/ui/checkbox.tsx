"use client";

import { cn } from "@/lib/utils";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import * as React from "react";

function Checkbox({
  className,
  isIndeterminate = false,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  isIndeterminate?: boolean;
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input bg-component size-4 shrink-0 rounded-[4px] border dark:shadow-xs/70 transition-shadow outline-none",
        "data-[state=checked]:text-primary-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary",
        "data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
        "focus-visible:ring-[3px]",
        "focus-visible:border-ring focus-visible:ring-ring/50",
        "dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary dark:data-[state=checked]:border-primary",
        "dark:data-[state=indeterminate]:text-primary-foreground dark:data-[state=indeterminate]:bg-primary dark:data-[state=indeterminate]:border-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex justify-center text-current transition-none"
      >
        {isIndeterminate ? (
          <MinusIcon className="size-3.5 text-primary-foreground group-[data-state=checked]/indicator:hidden" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

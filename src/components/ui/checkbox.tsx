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
                "data-[state=checked]:text-blue-600 data-[state=checked]:bg-blue-200 data-[state=checked]:border-blue-500",
                "data-[state=indeterminate]:text-blue-600 data-[state=indeterminate]:bg-blue-200 data-[state=indeterminate]:border-blue-500",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
                "focus-visible:ring-[3px]",
                "focus-visible:border-ring focus-visible:ring-ring/50",
                "dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:text-blue-200 dark:data-[state=checked]:bg-blue-300/40 dark:data-[state=checked]:border-input",
                "dark:data-[state=indeterminate]:text-blue-200 dark:data-[state=indeterminate]:bg-blue-300/40 dark:data-[state=indeterminate]:border-input",
                className
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator
                data-slot="checkbox-indicator"
                className="flex justify-center text-current transition-none"
            >
                {isIndeterminate ? (
                    <MinusIcon className="size-3.5 text-blue-500 dark:text-blue-200  group-[data-state=checked]/indicator:hidden" />
                ) : (
                    <CheckIcon className="size-3.5" />
                )}
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}

export { Checkbox };

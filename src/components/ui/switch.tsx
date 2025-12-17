"use client";

import { cn } from "@/lib/utils";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, VariantProps } from "class-variance-authority";
import * as React from "react";

const switchVariants = cva(
    "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
    {
        variants: {
            size: {
                default: "h-[1.15rem] w-8",
                sm: "h-3 w-6",
            },
        },
        defaultVariants: {
            size: "default",
        },
    }
);

function Switch({
    className,
    size,
    ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & VariantProps<typeof switchVariants>) {
    const notchSize = size === "sm" ? "size-3" : "size-4";
    const notchPosition =
        size === "sm"
            ? "data-[state=checked]:translate-x-[calc(100%)] size-2.5"
            : "data-[state=checked]:translate-x-[calc(100%-2px)]";

    return (
        <SwitchPrimitive.Root
            aria-setsize={1}
            data-slot="switch"
            className={cn(switchVariants({ size, className }))}
            {...props}
        >
            <SwitchPrimitive.Thumb
                data-slot="switch-thumb"
                className={cn(
                    "bg-background duration-0 dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block rounded-full ring-0 transition-transform data-[state=unchecked]:translate-x-0",
                    notchSize,
                    notchPosition
                )}
            />
        </SwitchPrimitive.Root>
    );
}

export { Switch };

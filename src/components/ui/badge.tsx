import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const badgeVariants = cva(
    "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
    {
        variants: {
            variant: {
                default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
                secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
                destructive:
                    "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
                outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
                embossed: cn(
                    "bg-zinc-200 border border-zinc-300 text-zinc-500 shadow-xs inset-shadow-xs inset-shadow-zinc-100",
                    "dark:bg-zinc-700/30 dark:text-zinc-300/80 dark:shadow-sm dark:inset-shadow-none dark:border-l-0 dark:border-zinc-500/30 dark:border-r-0 dark:border-b-0 dark:shadow-zinc-900 dark:inset-ring dark:inset-ring-zinc-600/20",
                    "hover:bg-zinc-300 hover:text-zinc-600 hover:dark:bg-zinc-700/40"
                ),
            },
            // size:{
            //   default:"text-xs",
            //   sm:"h-4"
            // }
        },
        defaultVariants: {
            variant: "default",
            // size:"defalut"
        },
    }
);

function Badge({
    className,
    variant,
    asChild = false,
    ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
    const Comp = asChild ? Slot : "span";

    return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

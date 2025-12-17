import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const buttonVariants = cva(
    "shadow-buttons-inverted select-none cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive active:scale-95",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive:
                    "inset-shadow-xs inset-shadow-red-400/30 bg-destructive border-t border-x border-red-400/80 shadow-sm/50  text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
                outline:
                    "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
                secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
                ghost: "shadow-none hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
                link: "text-muted-foreground shadow-none underline-offset-4 hover:underline",
                form: "bg-form-button inset-shadow-xs inset-shadow-white/30 text-white dark:hover:bg-primary/50 hover:bg-primary/90",
                formDark: cn(
                    "bg-zinc-200 border border-zinc-300 text-zinc-500 shadow-xs inset-shadow-xs inset-shadow-zinc-100",
                    "dark:bg-zinc-700/30 dark:text-zinc-300/80 dark:shadow-sm dark:inset-shadow-none dark:border-l-0 dark:border-zinc-500/30 dark:border-r-0 dark:border-b-0 dark:shadow-zinc-900 dark:inset-ring dark:inset-ring-zinc-600/20",
                    "hover:bg-zinc-300 hover:text-zinc-600 hover:dark:bg-zinc-700/40"
                ),
                cardHeader: cn(
                    "bg-zinc-100 border border-zinc-200 text-zinc-500 shadow-xs inset-shadow-xs inset-shadow-white",
                    "dark:bg-zinc-700/30 dark:text-zinc-300/80 dark:shadow-sm dark:inset-shadow-none dark:border-l-0 dark:border-zinc-500/30 dark:border-r-0 dark:border-b-0 dark:shadow-zinc-900 dark:inset-ring dark:inset-ring-zinc-600/20",
                    "hover:bg-zinc-300/40 hover:text-zinc-600 hover:dark:bg-zinc-700/40"
                ),
                none: "bg-transparent shadow-none hover:bg-zinc-800 text-muted-foreground hover:bg-transparent",
            },
            size: {
                default: "px-3 py-1.5 has-[>svg]:px-3 text-xs",
                xs: "h-7 gap-1.5 px-2.5 has-[>svg]:px-2",
                sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
                lg: "h-10 px-6 has-[>svg]:px-4",
                icon: "size-7",
            },
            rounded: {
                base: "rounded-md-plus",
                full: "rounded-full",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
            rounded: "base",
        },
    }
);

function Button({
    className,
    variant,
    size,
    asChild = false,
    rounded,
    ...props
}: React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    }) {
    const Comp = asChild ? Slot : "button";

    return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className, rounded }))} {...props} />;
}

export { Button, buttonVariants };

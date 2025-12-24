import { cn } from "@/lib/utils";
import { cva, VariantProps } from "class-variance-authority";
import * as React from "react";

const inputVariants = cva(
  cn(
    "bg-background relative shadow-xs file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex w-full min-w-0 rounded-md-plus border px-3 py-1.5 text-sm transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 leading-5",
    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  ),
  {
    variants: {
      variant: {
        default: "",
        card: cn(
          "bg-zinc-100 shadow-sm rounded-md-plus shadow-zinc-300 text-foreground placeholder:text-zinc-400 border border-border inset-shadow-xs inset-shadow-white",
          "dark:bg-zinc-700/30 dark:placeholder:text-zinc-500 dark:shadow-sm dark:inset-shadow-none dark:border-border dark:border-b-0 dark:shadow-zinc-900 dark:inset-ring dark:inset-ring-zinc-600/20",
          "hover:bg-zinc-300/40 hover:dark:bg-zinc-700/40",
        ),
      },
      size: {
        xs: "h-7 rounded-md-plus",
        sm: "h-8",
        md: "h-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> &
    VariantProps<typeof inputVariants>
>(({ className, type, variant, size, ...props }, ref) => {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };

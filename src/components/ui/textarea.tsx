import * as React from "react";

import { cn } from "@/lib/utils";
import { cva, VariantProps } from "class-variance-authority";

const textareaVariants = cva(
  cn(
    "bg-background relative shadow-sm shadow-zinc-300 file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex w-full min-w-0 rounded-md-plus border px-3 py-1.5 text-sm transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 leading-5",
    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  ),
  {
    variants: {
      variant: {
        default: "",
        card: cn(
          "bg-zinc-100 rounded-md-plus text-foreground placeholder:text-zinc-400 border border-zinc-200 shadow-xs inset-shadow-xs inset-shadow-white",
          "dark:bg-zinc-700/30 dark:shadow-950 dark:placeholder:text-zinc-500 dark:shadow-sm dark:inset-shadow-none dark:border-zinc-500/30 dark:border-b-0 dark:shadow-zinc-900 dark:inset-ring dark:inset-ring-zinc-600/20",
          "hover:bg-zinc-300/40 hover:dark:bg-zinc-700/40",
        ),
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>
>(({ className, variant = "default", ...props }, ref) => {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "tw-:border-input tw-:placeholder:text-muted-foreground tw-:focus-visible:border-ring tw-:focus-visible:ring-ring/50 tw-:aria-invalid:ring-destructive/20 tw-:dark:aria-invalid:ring-destructive/40 tw-:aria-invalid:border-destructive tw-:dark:bg-input/30 tw-:flex tw-:field-sizing-content tw-:min-h-16 tw-:w-full tw-:rounded-md tw-:border tw-:bg-transparent tw-:px-3 tw-:py-2 tw-:text-base tw-:shadow-xs tw-:transition-[color,box-shadow] tw-:outline-none tw-:focus-visible:ring-[3px] tw-:disabled:cursor-not-allowed tw-:disabled:opacity-50 tw-:md:text-sm",
        textareaVariants({ variant, className }),
      )}
      ref={ref}
      {...props}
    />
  );
});

Textarea.displayName = "Textarea";

export { Textarea };

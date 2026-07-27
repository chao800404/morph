import * as React from "react";

import { cn } from "@/lib/utils";
import { cva, VariantProps } from "class-variance-authority";
import { fieldControlVariants } from "./field-control";

const textareaVariants = cva(
  "relative flex w-full min-w-0 px-3 py-1.5 text-sm leading-5 selection:bg-primary selection:text-primary-foreground",
  {
    variants: {
      variant: {
        default: fieldControlVariants({ variant: "default" }),
        card: fieldControlVariants({ variant: "card" }),
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
      className={cn(textareaVariants({ variant, className }))}
      ref={ref}
      {...props}
    />
  );
});

Textarea.displayName = "Textarea";

export { Textarea };

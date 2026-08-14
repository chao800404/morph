import { cn } from "@/lib/utils";
import { cva, VariantProps } from "class-variance-authority";
import * as React from "react";
import {
  fieldControlDensity,
  fieldControlVariants,
  focusRing,
} from "./field-control";

const inputVariants = cva(
  cn(
    "relative flex w-full min-w-0 text-sm leading-5",
    fieldControlDensity.control,
    "file:text-foreground selection:bg-primary selection:text-primary-foreground",
    "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
  ),
  {
    variants: {
      variant: {
        default: fieldControlVariants({ variant: "default" }),
        card: fieldControlVariants({ variant: "card" }),
        bare: cn(
          "border-0 bg-transparent text-foreground shadow-none outline-none",
          focusRing,
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
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

export { Input, inputVariants };

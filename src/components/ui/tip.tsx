import { Alert } from "@/components/ui/alert";
import {
  fieldControlDensity,
  fieldControlVariants,
} from "@/components/ui/field-control";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * An inline hint explaining how a screen behaves.
 *
 * Built on `Alert` rather than beside it: the box metrics — radius, border,
 * padding, text size — belong to one primitive, so a change to `Alert` cannot
 * leave tips behind. Its surface colour follows the shared card-field token,
 * while the accent rail remains its only Tip-specific decoration.
 *
 * `role="note"` overrides `Alert`'s `role="alert"`. A tip is not urgent, and an
 * alert role interrupts screen readers.
 */
export const Tip = ({
  children,
  label = "Tip:",
  className,
}: {
  children: ReactNode;
  label?: ReactNode;
  className?: string;
}) => (
  <Alert
    variant="muted"
    role="note"
    className={cn(
      fieldControlVariants({ variant: "card" }),
      fieldControlDensity.default,
      "flex items-stretch gap-3 text-muted-foreground",
      className,
    )}
  >
    {/* Inset and rounded, so it reads as a rail rather than the card's own
        border. Decorative: the label already carries the meaning. */}
    <span
      aria-hidden
      className="w-0.5 shrink-0 rounded-full bg-muted-foreground/40"
    />
    <p className="leading-relaxed">
      <span className="font-medium text-foreground">{label}</span> {children}
    </p>
  </Alert>
);

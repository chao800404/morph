import { fieldControlVariants } from "@/components/ui/field-control";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ChoiceCardsFormField } from "@/lib/validations/form";

export const ChoiceCardsField = ({
  field,
  value,
  onChange,
}: {
  field: ChoiceCardsFormField;
  value: string;
  onChange?: (value: string) => void;
}) => {
  const labelId = `field-${field.name}-label`;
  return (
    <div className="space-y-3">
      {field.label ? (
        <Label id={labelId} className="text-sm font-medium">
          {field.label}
          {field.optional ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              (Optional)
            </span>
          ) : null}
        </Label>
      ) : null}
      <div
        className="space-y-3"
        role="radiogroup"
        aria-labelledby={field.label ? labelId : undefined}
        aria-label={field.label ? undefined : field.name}
      >
        {field.options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={field.disabled}
              onClick={() => onChange?.(option.value)}
              className={cn(
                fieldControlVariants({ variant: "card" }),
                "w-full p-4 text-left transition-[color,background-color,border-color,box-shadow,transform] active:scale-[0.995]",
                selected &&
                  "border-primary/50 bg-primary/5 ring-[1.5px] ring-inset ring-primary/50 shadow-sm hover:bg-primary/10",
              )}
            >
              <span className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border shadow-xs",
                    selected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/50 bg-background",
                  )}
                >
                  {selected ? (
                    <span className="size-1.5 rounded-full bg-primary-foreground" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

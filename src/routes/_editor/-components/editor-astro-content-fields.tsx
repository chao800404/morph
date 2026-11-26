import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AstroInspectorField } from "@/lib/storefront/editor/astro-inspector-write";
import { cn } from "@/lib/utils";

/**
 * What the Inspector's Content tab shows for an Astro section Core confirmed
 * (owner decision D2, M2 PR 3). The shell decides everything here: which
 * fields (`astroInspectorFields`: declared in `.fields.ts` and proven by
 * Core for the call site), what the inputs start from, and where an input
 * goes (the shell's one content write path, the #399 gate included).
 *
 * Content values only. No structure control (add, reorder, bind, rename,
 * hide) is offered for an Astro page, and Core refuses them as well.
 */
export type EditorAstroContent = Readonly<{
  sectionId: string;
  /** Changes when the selection or its document does; inputs start again. */
  resetKey: string;
  fields: readonly AstroInspectorField[];
  /** The section's values as the editor holds them now, read at mount. */
  values: () => Readonly<Record<string, unknown>>;
  onChange: (fieldKey: string, value: string) => void;
  onBlur: () => void;
  onOpenInCode: () => void;
}>;

export function EditorAstroContentFields({
  content,
  className,
}: {
  content: EditorAstroContent;
  className?: string;
}) {
  return (
    <section
      data-astro-inspector-content={content.sectionId}
      aria-label={`Content of ${content.sectionId}`}
      className={cn("space-y-3 px-3 py-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-xs font-medium">{content.sectionId}</h3>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={content.onOpenInCode}
        >
          Open in Code
        </Button>
      </div>
      <AstroContentInputs key={content.resetKey} content={content} />
    </section>
  );
}

function AstroContentInputs({ content }: { content: EditorAstroContent }) {
  const baseId = useId();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const held = content.values();
    return Object.fromEntries(
      content.fields.map((field) => {
        const value = held[field.key];
        return [field.key, typeof value === "string" ? value : ""];
      }),
    );
  });
  if (content.fields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This section has no field Design can edit. Edit it in Code mode.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {content.fields.map((field) => {
        const id = `${baseId}-${field.key}`;
        if (field.input === null) {
          return (
            <p key={field.key} className="text-xs text-muted-foreground">
              {field.label}: edit this field in Code mode.
            </p>
          );
        }
        const onValue = (value: string) => {
          setValues((current) => ({ ...current, [field.key]: value }));
          content.onChange(field.key, value);
        };
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={id} className="text-xs">
              {field.label}
            </Label>
            {field.input === "textarea" ? (
              <Textarea
                id={id}
                value={values[field.key] ?? ""}
                onChange={(event) => onValue(event.currentTarget.value)}
                onBlur={content.onBlur}
                rows={3}
              />
            ) : (
              <Input
                id={id}
                value={values[field.key] ?? ""}
                onChange={(event) => onValue(event.currentTarget.value)}
                onBlur={content.onBlur}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

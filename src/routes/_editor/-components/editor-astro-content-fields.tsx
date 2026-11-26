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
 * Core for the call site), what the inputs show, and where an input goes
 * (the shell's one content write path, the #399 gate included).
 *
 * Content values only. No structure control (add, reorder, bind, rename,
 * hide) is offered for an Astro page, and Core refuses them as well.
 */
export type EditorAstroContent = Readonly<{
  sectionId: string;
  /** Changes when the selection or its document does; inputs start again. */
  resetKey: string;
  fields: readonly AstroInspectorField[];
  /** The section's values as the editor holds them now. */
  values: () => Readonly<Record<string, unknown>>;
  /**
   * What the values are read from now (Codex review P2): the draft
   * generation of the accepted copy of the section's document, and the
   * confirmed selection object (a re-derive makes a new one). When either
   * changes, every input the author is not holding shows the accepted value
   * again, at this generation.
   */
  shown: Readonly<{ generation: number | undefined; selection: object }>;
  /** The fields this editor holds unsaved or unanswered input for. */
  heldFields: () => ReadonlySet<string>;
  /**
   * An input, with the generation of the copy the field showed when the
   * author typed into it: what the input is staged as made on.
   */
  onChange: (
    fieldKey: string,
    value: string,
    shownGeneration: number | undefined,
  ) => void;
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

type ShownInput = Readonly<{
  value: string;
  /** The accepted copy's generation this value was read at. */
  generation: number | undefined;
}>;

/** Every field as the accepted copy holds it, except those kept from `keep`. */
function readInputs(
  content: EditorAstroContent,
  keep?: Readonly<Record<string, ShownInput>>,
): Record<string, ShownInput> {
  const accepted = content.values();
  const held = keep ? content.heldFields() : new Set<string>();
  return Object.fromEntries(
    content.fields.map((field) => {
      const kept = keep?.[field.key];
      if (kept && held.has(field.key)) return [field.key, kept];
      const value = accepted[field.key];
      return [
        field.key,
        {
          value: typeof value === "string" ? value : "",
          generation: content.shown.generation,
        },
      ];
    }),
  );
}

function AstroContentInputs({ content }: { content: EditorAstroContent }) {
  const baseId = useId();
  const [inputs, setInputs] = useState<Record<string, ShownInput>>(() =>
    readInputs(content),
  );
  // Codex review P2: refreshed from the accepted copy when the editor
  // accepts a newer Document (another tab's write, read here) or the
  // selection is confirmed again, so a stale value is never typed over at
  // the new generation. A field the author holds input for keeps it.
  const [shown, setShown] = useState(content.shown);
  if (
    shown.generation !== content.shown.generation ||
    shown.selection !== content.shown.selection
  ) {
    setShown(content.shown);
    setInputs((current) => readInputs(content, current));
  }
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
        const input = inputs[field.key];
        const onValue = (value: string) => {
          // Staged as made on the copy this field showed.
          const generation = input?.generation;
          setInputs((current) => ({
            ...current,
            [field.key]: { value, generation },
          }));
          content.onChange(field.key, value, generation);
        };
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={id} className="text-xs">
              {field.label}
            </Label>
            {field.input === "textarea" ? (
              <Textarea
                id={id}
                value={input?.value ?? ""}
                onChange={(event) => onValue(event.currentTarget.value)}
                onBlur={content.onBlur}
                rows={3}
              />
            ) : (
              <Input
                id={id}
                value={input?.value ?? ""}
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

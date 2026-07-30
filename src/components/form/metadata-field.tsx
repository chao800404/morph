import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

/**
 * Free-form key/value editor for a record's `metadata` column.
 *
 * Values are stored as strings. Metadata is an escape hatch for data the core
 * schema does not model, and guessing types from what was typed is worse than
 * not guessing: `01234` would survive as a string while `1234` silently became
 * a number, so a postcode or an SKU would change meaning depending on its
 * digits. Anything needing a real type belongs in a real column.
 *
 * The value travels as a JSON object string, the same way `option-values`
 * submits its list — `FormFieldValue` has no object member, and widening it
 * would touch every field type for one of them.
 */

export interface MetadataEntry {
  key: string;
  value: string;
}

/** Parse the field's transport string, tolerating anything unexpected. */
export const parseMetadataEntries = (raw: string | undefined): MetadataEntry[] => {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }

  return Object.entries(parsed as Record<string, unknown>).map(
    ([key, value]) => ({
      key,
      // A value written by an import or the API may not be a string; show it as
      // JSON rather than `[object Object]` so nothing looks empty.
      value: typeof value === "string" ? value : JSON.stringify(value),
    }),
  );
};

/**
 * Back to a JSON object string.
 *
 * Blank keys are dropped, and a repeated key keeps its last value — an object
 * cannot hold both, and silently keeping the first would contradict what the
 * editor shows.
 */
export const serializeMetadataEntries = (entries: MetadataEntry[]): string =>
  JSON.stringify(
    entries.reduce<Record<string, string>>((result, entry) => {
      const key = entry.key.trim();
      if (key !== "") result[key] = entry.value;
      return result;
    }, {}),
  );

export const MetadataField = ({
  name,
  value,
  onChange,
}: {
  name: string;
  value?: string;
  onChange?: (name: string, value: string) => void;
}) => {
  const rowId = useId();
  const [entries, setEntries] = useState<MetadataEntry[]>(() =>
    parseMetadataEntries(value),
  );

  const update = (next: MetadataEntry[]) => {
    setEntries(next);
    onChange?.(name, serializeMetadataEntries(next));
  };

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={serializeMetadataEntries(entries)} />

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No metadata yet. Add a key to store data the catalogue does not model.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Label className="text-xs text-muted-foreground">Key</Label>
            <Label className="text-xs text-muted-foreground">Value</Label>
            <span className="w-9" aria-hidden />
          </div>

          {entries.map((entry, index) => (
            <div
              key={`${rowId}-${index}`}
              className="grid grid-cols-[1fr_1fr_auto] gap-2"
            >
              <Input
                variant="card"
                aria-label={`Key ${index + 1}`}
                placeholder="e.g. supplier_code"
                value={entry.key}
                onChange={(event) =>
                  update(
                    entries.map((current, position) =>
                      position === index
                        ? { ...current, key: event.target.value }
                        : current,
                    ),
                  )
                }
              />
              <Input
                variant="card"
                aria-label={`Value ${index + 1}`}
                value={entry.value}
                onChange={(event) =>
                  update(
                    entries.map((current, position) =>
                      position === index
                        ? { ...current, value: event.target.value }
                        : current,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${entry.key || `entry ${index + 1}`}`}
                onClick={() =>
                  update(entries.filter((_, position) => position !== index))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="self-start gap-2"
        onClick={() => update([...entries, { key: "", value: "" }])}
      >
        <Plus className="size-4" />
        Add key
      </Button>
    </div>
  );
};

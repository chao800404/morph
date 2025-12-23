import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/validations/form";

interface FieldsRendererProps {
  fields: FormField[];
  onChange?: (name: string, value: string) => void;
  className?: string;
}

export const FieldsRenderer = ({
  fields,
  onChange,
  className,
}: FieldsRendererProps) => {
  return (
    <div className={cn("grid gap-4", className)}>
      {fields.map((field) => {
        const id = `field-${field.name}`;

        return (
          <div key={field.name} className="space-y-2">
            {field.type !== "hidden" && (
              <Label htmlFor={id} className="text-sm font-medium">
                {field.name}
              </Label>
            )}

            {field.type === "input" && (
              <Input
                id={id}
                name={field.name}
                defaultValue={field.value}
                onChange={(e) => onChange?.(field.name, e.target.value)}
                placeholder={`Enter ${field.name.toLowerCase()}...`}
              />
            )}

            {field.type === "textarea" && (
              <Textarea
                id={id}
                name={field.name}
                defaultValue={field.value}
                onChange={(e) => onChange?.(field.name, e.target.value)}
                placeholder={`Enter ${field.name.toLowerCase()}...`}
                className="min-h-[100px]"
              />
            )}

            {field.type === "select" && (
              <Select
                name={field.name}
                defaultValue={field.value}
                onValueChange={(value) => onChange?.(field.name, value)}
              >
                <SelectTrigger id={id}>
                  <SelectValue
                    placeholder={`Select ${field.name.toLowerCase()}`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {field.type === "hidden" && (
              <input type="hidden" name={field.name} value={field.value} />
            )}

            {/* folder-select fields can be expanded based on your specific implementation */}
            {field.type === "folder-select" && (
              <div className="flex items-center gap-2 p-3 text-xs border rounded-md bg-muted/50 italic text-muted-foreground">
                {field.type} component not yet fully implemented
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

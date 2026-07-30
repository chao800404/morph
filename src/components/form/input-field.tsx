import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import type { InputFormField } from "@/lib/validations/form";
import type { RefObject } from "react";

/**
 * The `input` field's control.
 *
 * Split out of `FieldsRenderer` because a field with an affix is a different
 * element tree, not a different class: the surface moves to the wrapper so the
 * `/` sits inside the control's box. Keeping that choice here means the renderer
 * still shows one branch per field type.
 */
export const InputField = ({
  field,
  fieldId,
  value,
  describedBy,
  onChange,
  inputRef,
}: {
  field: InputFormField;
  fieldId: string;
  value: string;
  describedBy?: string;
  onChange?: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) => {
  const affixed = Boolean(field.prefix || field.suffix);
  const Control = affixed ? InputGroupInput : Input;

  const control = (
    <Control
      id={fieldId}
      // Inside a group the wrapper is the surface, so the control adds none.
      variant={affixed ? undefined : "card"}
      name={field.name}
      type={field.inputType || "text"}
      defaultValue={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={field.placeholder || `Enter ${field.label}...`}
      autoFocus={field.autoFocus}
      disabled={field.disabled}
      required={field.required}
      aria-invalid={field.error ? true : undefined}
      aria-describedby={describedBy}
      className={field.inputClassName}
      ref={inputRef}
    />
  );

  if (!affixed) return control;

  return (
    <InputGroup variant="card" className={field.componentClassName}>
      {field.prefix ? (
        <InputGroupAddon separated>{field.prefix}</InputGroupAddon>
      ) : null}
      {control}
      {field.suffix ? (
        <InputGroupAddon align="inline-end" separated>
          {field.suffix}
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
};

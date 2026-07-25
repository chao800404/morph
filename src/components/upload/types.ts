import type {
  FolderSelectFormField,
  FormField,
  InputFormField,
  SelectFormField,
  TextareaFormField,
  UploadFormField,
} from "@/lib/validations/form";

/**
 * Field configuration used by the shared dialogs.
 *
 * These are aliases of the single `FormField` union declared in
 * `@/lib/validations/form`. Field shapes must not be redeclared here: the Zod
 * schema in that module is the source of truth so `FieldsRenderer` and the
 * dialog stores validate exactly what they render.
 */
export type FieldConfig = FormField;

export type InputFieldConfig = InputFormField;
export type TextareaFieldConfig = TextareaFormField;
export type SelectFieldConfig = SelectFormField;
export type UploadFieldConfig = UploadFormField;
export type FolderSelectFieldConfig = FolderSelectFormField;

export type { SelectOption } from "@/lib/validations/form";

export type SelectFieldRenderProps = {
  field: SelectFieldConfig;
  fieldId: string;
  initialValue: string;
  onChange?: (value: string) => void;
  className?: string;
};

export type UploadFieldRenderProps = {
  field: UploadFieldConfig;
  fieldId: string;
  onChange?: (files: File[]) => void;
  className?: string;
};

export type FolderSelectFieldRenderProps = {
  field: FolderSelectFieldConfig;
  fieldId: string;
  initialValue: string;
  onChange?: (value: string) => void;
  className?: string;
};

import type { Input } from "@/components/ui/input";
import type { ComponentProps } from "react";

type FieldBase = {
  name: string;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  defaultValue?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  colSpan?: number;
  componentClassName?: string;
};

export type InputFieldConfig = FieldBase & {
  type: "input";
  inputType?: ComponentProps<typeof Input>["type"];
  autoFocus?: boolean;
};

export type TextareaFieldConfig = FieldBase & {
  type: "textarea";
  rows?: number;
};

export type SelectOption = {
  label: string;
  value: string;
};

export type SelectFieldConfig = FieldBase & {
  type: "select";
  options: SelectOption[];
  placeholder?: string;
};

export type UploadFieldConfig = FieldBase & {
  type: "upload";
  placeholder?: string;
  accept?: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number;
  minSize?: number;
};

export type FolderSelectFieldConfig = FieldBase & {
  type: "folder-select";
  placeholder?: string;
  excludedIds?: string[];
};

export type LanguageFieldConfig = FieldBase & {
  type: "language";
  placeholder?: string;
};

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

export type LanguageFieldRenderProps = {
  field: LanguageFieldConfig;
  fieldId: string;
  initialValue: string;
  onChange?: (value: string) => void;
  className?: string;
};

export type FieldConfig =
  | InputFieldConfig
  | TextareaFieldConfig
  | SelectFieldConfig
  | UploadFieldConfig
  | FolderSelectFieldConfig
  | LanguageFieldConfig;

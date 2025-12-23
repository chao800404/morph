import { AnyFieldApi } from "@tanstack/react-form";
import { AlertCircle } from "lucide-react";

export const FieldInfo = ({ field }: { field: AnyFieldApi }) => {
  if (field.state.meta.errors.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-destructive text-xs mt-1">
      <AlertCircle className="h-4 w-4" />
      <em>{field.state.meta.errors.join(", ")}</em>
    </div>
  );
};

import {
  RouteFormPage,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { notImplementedAction } from "@/lib/not-implemented-action";
import type { FormField } from "@/lib/validations/form";
import { toast } from "sonner";

/**
 * Create page for a view whose server side does not exist yet.
 *
 * The form is real so the shape can be reviewed, but submitting always fails —
 * a placeholder that closed with a success toast would be lying about having
 * saved something. Replace the whole component once the resource has a schema,
 * DAL and server function.
 */
export const NotImplementedCreate = ({
  feature,
  title,
  description,
  fields,
}: {
  feature: string;
  title: string;
  description?: string;
  fields: FormField[];
}) => {
  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const result = await notImplementedAction(feature)({ data: formData });
    toast.error(result.message, {
      description: result.description,
      position: "top-center",
    });
    return result;
  };

  return (
    <RouteFormPage
      title={title}
      description={description}
      fields={fields}
      action={submit}
    />
  );
};

import { FieldsRenderer } from "@/components/form/fields-renderer";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/validations/form";
import { useActionState, type ReactNode } from "react";
import { useCloseOnEscape, useRouteModalClose } from "./route-modal-close";

// Re-exported so the many call sites that reach for these through the modal
// keep working; the definitions live in the smaller module.
export {
  RouteModalCloseProvider,
  useCloseOnEscape,
  useRouteModalClose,
} from "./route-modal-close";
import { createSurface } from "./create-surface";
import {
  DialogFooterActions,
  type SubmitAction,
} from "./dialog-footer-actions";
import { RouteFullscreenSurface } from "./route-fullscreen-surface";

/**
 * The shell a create or edit page renders in.
 *
 * Create surfaces are routes, not dialogs opened from page state — the page
 * underneath stays mounted and closing is a navigation back to it. This is the
 * shell that makes a route look like a modal.
 *
 * It always fills the viewport, whatever the form's size. The content column
 * inside is capped and centred, so a two-field form does not stretch across a
 * wide screen — the card is full width, the fields are not.
 */

export const RouteFormModal = ({
  label,
  header,
  footer,
  children,
}: {
  /** Names the surface for assistive tech; see `RouteFullscreenSurface`. */
  label: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) => {
  const close = useRouteModalClose();

  return (
    <RouteFullscreenSurface
      onClose={close}
      label={label}
      header={header}
      footer={footer}
      bodyClassName="overflow-y-auto"
    >
      {children}
    </RouteFullscreenSurface>
  );
};

export interface RouteFormState {
  message: string;
  success?: boolean;
  errors?: Record<string, string[]>;
}

const initialState: RouteFormState = { message: "", success: undefined };

/**
 * A create page whose whole content is a field list.
 *
 * Simple resources get their form for free — the page declares its fields and
 * its action, and this supplies the shell, the submit plumbing and the footer.
 * A form with steps or its own layout uses `RouteFormModal` directly instead.
 */
export const RouteFormPage = ({
  title,
  description,
  fields,
  action,
  submitLabel = "Create",
  loadingLabel = "Creating...",
  additionalActions,
  fieldsClassName,
}: {
  title: string;
  description?: string;
  fields: FormField[];
  /** Grid overrides for forms whose fields are not a single column. */
  fieldsClassName?: string;
  action: (
    state: RouteFormState,
    formData: FormData,
  ) => Promise<RouteFormState>;
  submitLabel?: string;
  loadingLabel?: string;
  additionalActions?: SubmitAction[];
}) => {
  const close = useRouteModalClose();
  useCloseOnEscape(close);

  const [, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="contents">
      <RouteFormModal
        label={title}
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={pending}
            onCancel={close}
            submitLabel={submitLabel}
            loadingLabel={loadingLabel}
            additionalActions={additionalActions}
          />
        }
      >
        <div className={createSurface.content}>
          <h2 className="text-md font-medium">{title}</h2>
          {description ? (
            <p className="text-base text-muted-foreground">{description}</p>
          ) : null}
          <FieldsRenderer
            fields={fields}
            className={cn("mt-8 grid-cols-1 gap-x-6 gap-y-8", fieldsClassName)}
          />
        </div>
      </RouteFormModal>
    </form>
  );
};

import { FieldsRenderer } from "@/components/form/fields-renderer";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/validations/form";
import {
  toDashboardReturnTo,
  type DashboardSearch,
} from "@/lib/validations/dashboard-search";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import {
  useActionState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
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
  header,
  footer,
  children,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) => {
  const close = useRouteModalClose();

  return (
    <RouteFullscreenSurface
      onClose={close}
      header={header}
      footer={footer}
      bodyClassName="overflow-y-auto"
    >
      {children}
    </RouteFullscreenSurface>
  );
};

/**
 * How far up closing goes.
 *
 * ".." is right when the parent route renders something — a create page sits on
 * its list, an edit page on its detail page. A collection with no detail page
 * has nothing at `/dashboard/<slug>/<id>`, so its edit page must skip that
 * level. The route knows which case applies; the page component should not have
 * to.
 */
const RouteModalCloseContext = createContext<string>("..");

export const RouteModalCloseProvider = RouteModalCloseContext.Provider;

/**
 * Closing returns to an ancestor route, which never unmounted. `replace` keeps
 * an abandoned form out of the history stack, so Back does not reopen it.
 *
 * An explicit `?returnTo` wins: a surface opened from somewhere other than its
 * parent — the product wizard reached from an option's page — should go back
 * where it came from. Reading it from the URL rather than from history means a
 * refresh or a pasted link still closes to the right place.
 */
export const useRouteModalClose = () => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const parent = useContext(RouteModalCloseContext);
  const returnTo = toDashboardReturnTo(search.returnTo);

  return useCallback(() => {
    void navigate({ to: returnTo ?? parent, replace: true });
  }, [navigate, parent, returnTo]);
};

/** Esc closes the surface, matching the hint next to the close button. */
export const useCloseOnEscape = (close: () => void) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
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
  action: (state: RouteFormState, formData: FormData) => Promise<RouteFormState>;
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

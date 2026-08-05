import {
  toDashboardReturnTo,
  type DashboardSearch,
} from "@/lib/validations/dashboard-search";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect } from "react";

/**
 * Closing a route-backed surface.
 *
 * Split out of `route-form-modal` so a `pendingView` can close itself without
 * importing `RouteFormPage` — and therefore `FieldsRenderer`. That single edge
 * put the whole form layer inside `cms.config`'s static import graph, which is
 * what stopped shared components from reading `getConfig()` at all.
 */

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

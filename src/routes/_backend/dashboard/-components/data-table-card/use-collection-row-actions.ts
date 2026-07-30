import { viewPreloader } from "@/lib/config/lazy-view";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { editActionIcon, type RowAction } from "./row-actions-menu";

/**
 * The Edit row action for a collection that declares `edit` in config.
 *
 * Editing is a route, so the action is a navigation — the same shape as the
 * Create button. Pages compose this with their own actions rather than each
 * building a link to a URL the framework owns.
 */
export const useCollectionEditAction = (slug: string) => {
  const navigate = useNavigate();

  const edit = useMemo(
    () => findCollection(getConfig().client.collections.global, slug)?.edit,
    [slug],
  );

  return useCallback(
    (id: string): RowAction[] =>
      edit
        ? [
            {
              label: edit.label ?? "Edit",
              icon: editActionIcon,
              preload: () => void viewPreloader(edit.view)?.(),
              onSelect: () =>
                void navigate({
                  to: "/dashboard/$slug/$id/edit",
                  params: { slug, id },
                }),
            },
          ]
        : [],
    [edit, navigate, slug],
  );
};

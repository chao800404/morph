import { useEffect } from "react";
import { create } from "zustand";

/**
 * The trailing breadcrumb a detail page contributes.
 *
 * The layout builds crumbs from the URL's slugs, which cannot name a record:
 * `/dashboard/categories/<id>` only says "Categories". The record's
 * name is known by the view that loaded it, so the view publishes it here and
 * the header appends it.
 *
 * Deliberately a single value rather than a stack — only one detail view is
 * mounted at a time, and a stack would need every contributor to unwind in
 * order.
 */
interface PageBreadcrumbState {
  label: string | null;
  setLabel: (label: string | null) => void;
}

export const usePageBreadcrumbStore = create<PageBreadcrumbState>((set) => ({
  label: null,
  setLabel: (label) => set({ label }),
}));

/**
 * Publish a trailing crumb for as long as the calling view is mounted.
 *
 * Pass `null` while the record is still loading; the crumb then appears once
 * the name is known instead of flashing a placeholder.
 */
export const usePageBreadcrumb = (label: string | null) => {
  const setLabel = usePageBreadcrumbStore((state) => state.setLabel);

  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
};

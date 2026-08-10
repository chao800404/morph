import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useViewPreload } from "../use-view-preload";
import { SquareArrowOutUpRight } from "lucide-react";
import { CardWrapper } from "../card-wrapper";

/**
 * The metadata summary on a detail page.
 *
 * Header only: the pairs themselves live behind the edit surface, because a
 * record can carry dozens and they would drown the sections that describe what
 * the record actually is. The count is the useful signal here.
 *
 * Not an `EditCard` — that renders label/value rows from a known field list,
 * whereas metadata's keys are whatever the store put there.
 *
 * It derives its own destination from the record's identity, the way
 * `CollectionCreateButton` does. A detail page that had to pass a handler would
 * be re-stating a URL the framework already owns, once per collection.
 */
export const MetadataCard = ({
  slug,
  id,
  keyCount,
  label = "Metadata",
  page = "metadata",
  childId,
  returnTo,
}: {
  slug: string;
  id: string;
  keyCount: number;
  label?: string;
  /** The `detail.pages` key holding the editor. */
  page?: string;
  /** Child-resource identity, such as a product variant. */
  childId?: string;
  /** Detail surface to restore after closing a child editor. */
  returnTo?: string;
}) => {
  const navigate = useNavigate();
  const view = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, slug)?.pages?.[page]
        ?.view,
    [slug, page],
  );
  const preload = useViewPreload(view);

  const openEditor = () => {
    if (childId) {
      void navigate({
        to: "/dashboard/$slug/$id/$page/$childId",
        params: { slug, id, page, childId },
        search: returnTo ? { returnTo } : undefined,
      });
      return;
    }

    void navigate({
      to: "/dashboard/$slug/$id/$page",
      params: { slug, id, page },
    });
  };

  return (
    <CardWrapper
      id="metadata-card"
      label={
        <span className="flex items-center gap-3">
          {label}
          <Badge variant="secondary">
            {keyCount} {keyCount === 1 ? "key" : "keys"}
          </Badge>
        </span>
      }
      headerButton={
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${label.toLowerCase()}`}
          {...preload}
          onClick={openEditor}
        >
          <SquareArrowOutUpRight className="size-4" />
        </Button>
      }
    />
  );
};

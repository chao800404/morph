import { Button } from "@/components/ui/button";
import { getAllCollections } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo } from "react";

/**
 * The Create button for a list page, driven by the collection's `create`
 * config.
 *
 * Every list page rendered the same button and differed only in what the click
 * did, which left the route-vs-dialog decision scattered across views. Here the
 * decision is declared once in the collection config and this reads it, so a
 * user adding their own collection gets the button by configuring it.
 */
export const CollectionCreateButton = ({
  slug,
  onCreate,
}: {
  slug: string;
  /** Required by `mode: "dialog"`; ignored by `mode: "route"`. */
  onCreate?: () => void;
}) => {
  const navigate = useNavigate();

  const create = useMemo(() => {
    const collections = getAllCollections(getConfig().client.collections.global);
    return collections.find((collection) => collection.slug === slug)?.create;
  }, [slug]);

  if (!create) return null;

  const label = create.label ?? "Create";
  const onClick =
    create.mode === "route"
      ? () => void navigate({ to: create.to })
      : onCreate;

  return (
    <Button onClick={onClick} variant="form" size="xs" className="gap-2">
      <Plus className="size-4" />
      {label}
    </Button>
  );
};

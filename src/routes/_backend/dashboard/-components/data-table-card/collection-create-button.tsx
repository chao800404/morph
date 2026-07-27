import { Button } from "@/components/ui/button";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo } from "react";

/**
 * The Create button for a list page, driven by the collection's `create`
 * config.
 *
 * A collection opts into the shared create route by declaring a `create` view.
 * The button only derives and opens that framework-owned URL.
 */
export const CollectionCreateButton = ({ slug }: { slug: string }) => {
  const navigate = useNavigate();

  const create = useMemo(
    () => findCollection(getConfig().client.collections.global, slug)?.create,
    [slug],
  );

  if (!create) return null;

  // The framework owns the create URL, so the button derives it from the
  // collection's slug rather than the config naming a path that could drift
  // from the route.
  const onClick = () =>
    void navigate({ to: "/dashboard/$slug/create", params: { slug } });

  return (
    <Button onClick={onClick} variant="form" size="xs" className="gap-2">
      <Plus className="size-4" />
      {create.label ?? "Create"}
    </Button>
  );
};

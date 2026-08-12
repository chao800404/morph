import { Button } from "@/components/ui/button";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useViewPreload } from "../use-view-preload";

/**
 * The Create button for a list page, driven by the collection's `create`
 * config.
 *
 * A collection opts into the shared create route by declaring a `create` view.
 * The button only derives and opens that framework-owned URL.
 */
export const CollectionCreateButton = ({
  slug,
  scope = "global",
}: {
  slug: string;
  scope?: "global" | "settings";
}) => {
  const navigate = useNavigate();

  const create = useMemo(
    () => findCollection(getConfig().client.collections[scope], slug)?.create,
    [scope, slug],
  );

  // Start the chunk on hover, so the click opens a form rather than a spinner.
  const preload = useViewPreload(create?.view);

  if (!create) return null;

  // The framework owns the create URL, so the button derives it from the
  // collection's slug rather than the config naming a path that could drift
  // from the route.
  const onClick = () =>
    scope === "settings"
      ? void navigate({
          to: "/dashboard/settings/$slug/create",
          params: { slug },
        })
      : void navigate({ to: "/dashboard/$slug/create", params: { slug } });

  return (
    <Button
      onClick={onClick}
      variant="form"
      size="xs"
      className="gap-2"
      {...preload}
    >
      <Plus className="size-4" />
      {create.label ?? "Create"}
    </Button>
  );
};

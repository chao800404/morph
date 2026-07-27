import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { cn } from "@/lib/utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { DEFAULT_ASSET_CREATE_VARIANT } from "../config/asset-create.config";

/**
 * `uploadConfig` used to be threaded in so this could build the create
 * dialog's fields. Uploading is a route now, so the button only navigates and
 * the create page reads the limits from config itself.
 */
type Props = { className?: string; showButton: boolean };

export const AssetEmptyCard = ({ className, showButton }: Props) => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;

  // Same destination as the header's Create menu; the folder in view rides
  // along so the upload lands where the user is looking.
  const openCreate = () =>
    void navigate({
      to: "/dashboard/$slug/create",
      params: { slug: "assets" },
      search: { ...search, variant: DEFAULT_ASSET_CREATE_VARIANT },
    });

  return (
    <div
      className={cn("flex h-full  items-center w-full justify-center", className)}
    >
      <div className="opacity-70 flex flex-col items-center">
        <EmptyFileIcon />
        {showButton && (
          <div className="mt-5">
            <Button onClick={openCreate} variant="form">
              Create First Asset
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { cn } from "@/lib/utils";
import { createItems } from "@/server/asset/create-items.serverFn";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useCreateStore } from "../../../../features/global-create/use-create-store";
import { getAssetsDialogConfig } from "../config/assets-dialog.config";

type Props = { className?: string } & (
  | {
      showButton: true;
      uploadConfig?: {
        maxFileSize: number;
        minFiles: number;
        maxFiles: number;
        allowedTypes: string[];
        allowedExtensions: string[];
      };
    }
  | {
      showButton: false;
    }
);

export const AssetEmptyCard = (props: Props) => {
  const uploadConfig = props.showButton ? props.uploadConfig : undefined;
  const queryClient = useQueryClient();

  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleClick = () => {
    if (!uploadConfig) return;

    const config = getAssetsDialogConfig("assets", uploadConfig);
    setCreateData({
      title: config.title,
      description: config.description,
      fields: config.fields,
      action: createItems,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
    });
    setCreateOpen(true);
  };

  return (
    <div
      className={cn(
        "flex h-full  items-center w-full justify-center",
        props.className,
      )}
    >
      <div className="opacity-70 flex flex-col items-center">
        <EmptyFileIcon />
        {props.showButton && (
          <div className="mt-5">
            <Button onClick={handleClick} variant="form">
              Create First Asset
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

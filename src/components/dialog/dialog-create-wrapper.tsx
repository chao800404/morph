import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { type ComponentProps, type ReactNode, useActionState } from "react";
import { createSurface } from "./create-surface";
import { DialogFooterActions } from "./dialog-footer-actions";
import { DialogHeaderActions } from "./dialog-header-actions";

/**
 * Standard ActionState for TanStack Start forms
 */
export interface ActionState {
  message: string;
  success?: boolean;
  errors?: Record<string, string[]>;
}

/**
 * Compatible action type for useActionState
 */
export type FormAction = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;

type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  action?: FormAction;
  children: ReactNode;
  onOpenAutoFocus?: ComponentProps<typeof DialogContent>["onOpenAutoFocus"];
  title?: ReactNode;
};

const initialState: ActionState = {
  message: "",
  success: undefined,
};

export const DialogCreateWrapper = ({
  open,
  onOpenChange,
  action,
  children,
  onOpenAutoFocus,
  title,
}: Props) => {
  const [, formAction, pending] = useActionState(
    action || (async () => initialState),
    initialState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn(
          createSurface.shell,
          "max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-1rem)] p-0 h-[calc(100%-1rem)]",
        )}
      >
        <form className="flex flex-col flex-1 min-h-0" action={formAction}>
          <DialogHeaderActions
            title={title}
            onClose={() => onOpenChange?.(false)}
          />
          <ScrollArea className={createSurface.body}>
            <ScrollBar />
            <div className={createSurface.content}>{children}</div>
          </ScrollArea>
          <div className={createSurface.footer}>
            <DialogFooterActions
              isLoading={pending}
              onCancel={() => onOpenChange?.(false)}
              submitLabel="Create"
              loadingLabel="Creating..."
              isSheet={false}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

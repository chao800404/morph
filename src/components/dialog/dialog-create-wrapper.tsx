import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useRouter } from "@tanstack/react-router";
import {
  type ComponentProps,
  type ReactNode,
  useActionState,
  useEffect,
} from "react";
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
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    action || (async () => initialState),
    initialState,
  );

  // Handle state changes - close dialog and invalidate on success
  useEffect(() => {
    if (state.success && state !== initialState) {
      onOpenChange?.(false);
      router.invalidate();
    }
  }, [state, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={onOpenAutoFocus}
        className="flex flex-col border border-border/30 max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-1rem)] p-0 h-[calc(100%-1rem)] bg-component"
      >
        <form className="flex flex-col flex-1 min-h-0" action={formAction}>
          <DialogHeaderActions
            title={title}
            onClose={() => onOpenChange?.(false)}
          />
          <ScrollArea
            className={cn(
              "w-full border-b flex-1 min-h-0 relative z-20 bg-component",
              "dark:shadow-elevation-modal dark:border-border/30",
            )}
          >
            <ScrollBar />
            <div className="pt-24 px-5 pb-10 max-w-3xl mx-auto relative z-50">
              {children}
            </div>
          </ScrollArea>
          <div
            className={cn(
              "bg-component h-fit border-ring/80 border-t-[0.5px] px-4 py-4 rounded-b-lg relative z-30",
              "dark:shadow-elevation-modal dark:border-border/30",
            )}
          >
            <DialogFooterActions
              isLoading={pending}
              onCancel={() => onOpenChange?.(false)}
              submitLabel="Create"
              loadingLabel="Creating..."
              isSheet={false}
              className="w-full justify-end"
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

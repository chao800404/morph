import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planNewThemePage } from "@/lib/storefront/compiler/theme-page-scaffold";

export type AddPageResult = Readonly<{ ok: boolean; reason?: string }>;

/**
 * Asking an author for the address of a page that does not exist yet.
 *
 * The same plan the server will run is run here on every keystroke, so a path
 * that cannot work is refused while it is still being typed rather than after
 * the author has committed to it. The server plans it again regardless: this
 * one is here to answer the author, not to decide anything.
 */
export function EditorAddPageDialog({
  open,
  onOpenChange,
  existingPaths,
  onAddPage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingPaths: readonly string[];
  onAddPage: (routePath: string) => Promise<AddPageResult>;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [serverReason, setServerReason] = useState<string | null>(null);

  const plan = value.trim()
    ? planNewThemePage({ requestedPath: value, existingPaths })
    : null;
  // Nothing typed yet is not a mistake, so it is not reported as one.
  const reason = serverReason ?? (plan && !plan.ok ? plan.reason : null);
  const canSubmit = Boolean(plan?.ok) && !pending;

  const close = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setValue("");
      setServerReason(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!plan?.ok || pending) return;
    setPending(true);
    setServerReason(null);
    try {
      const result = await onAddPage(plan.routePath);
      if (!result.ok) {
        setServerReason(result.reason ?? "Could not add the page.");
        return;
      }
      setValue("");
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add page</DialogTitle>
          <DialogDescription>
            The address this page answers on. Sections can be added to it once
            it exists.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="morph-add-page-path">Path</Label>
          <Input
            id="morph-add-page-path"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setServerReason(null);
            }}
            placeholder="/about"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={reason ? true : undefined}
            aria-describedby={
              reason ? "morph-add-page-error" : "morph-add-page-hint"
            }
          />
          {reason ? (
            <p
              id="morph-add-page-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {reason}
            </p>
          ) : (
            <p
              id="morph-add-page-hint"
              className="text-xs text-muted-foreground"
            >
              {plan?.ok
                ? `Creates ${plan.sourcePath}`
                : "For example /about, or /blog/first-post."}
            </p>
          )}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? "Adding…" : "Add page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

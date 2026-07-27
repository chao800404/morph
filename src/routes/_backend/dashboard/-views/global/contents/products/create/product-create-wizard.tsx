import { createSurface } from "@/components/dialog/create-surface";
import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductStatus } from "@/db/product.schema";
import { createProduct } from "@/server/product/create-product.serverFn";
import { productQueries } from "@queries/product.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, CircleDashed, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { StepDetails } from "./step-details";
import { StepOrganize } from "./step-organize";
import { StepVariants } from "./step-variants";
import { toMinorUnits, useProductDraft } from "./use-product-draft";

const STEPS = ["Details", "Organize", "Variants"] as const;
type StepIndex = 0 | 1 | 2;

export const ProductCreateWizard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, dispatch] = useProductDraft();
  const [step, setStep] = useState<StepIndex>(0);
  const [pending, setPending] = useState(false);

  const close = useCallback(() => {
    void navigate({ to: "/dashboard/$slug", params: { slug: "products" } });
  }, [navigate]);

  // Esc closes the flow, matching the hint next to the close button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const detailsValid =
    draft.title.trim() !== "" &&
    (!draft.hasVariants ||
      draft.options.some((option) => option.selectedValueIds.length > 0));

  const submit = useCallback(
    async (status: ProductStatus) => {
      if (!detailsValid) {
        setStep(0);
        toast.error("Add a title, and pick an option with at least one value.", {
          position: "top-center",
        });
        return;
      }

      setPending(true);
      const toastId = toast.loading("Creating product...", {
        position: "top-center",
      });

      try {
        // The library owns the option and its values, so only ids travel; the
        // server resolves them and rejects anything the option does not own.
        const options = draft.hasVariants
          ? draft.options
              .filter((option) => option.selectedValueIds.length > 0)
              .map((option) => ({
                optionId: option.optionId,
                valueIds: option.available
                  .filter((value) =>
                    option.selectedValueIds.includes(value.id),
                  )
                  .map((value) => value.id),
              }))
          : [];

        const buildPrices = (prices: Record<string, string>) =>
          draft.currencies
            .map((currency) => ({
              currencyCode: currency,
              amount: toMinorUnits(prices[currency] ?? ""),
            }))
            .filter((price) => price.amount > 0);

        const result = await createProduct({
          data: {
            title: draft.title.trim(),
            handle: draft.handle.trim() || undefined,
            subtitle: draft.subtitle.trim() || null,
            description: draft.description.trim() || null,
            status,
            collectionId: draft.collectionId || null,
            options,
            prices: draft.hasVariants ? [] : buildPrices(draft.defaultPrices),
            variants: draft.hasVariants
              ? draft.variants
                  .filter((variant) => variant.included)
                  .map((variant) => ({
                    title: variant.title.trim() || variant.key,
                    sku: variant.sku.trim() || null,
                    manageInventory: variant.manageInventory,
                    allowBackorder: variant.allowBackorder,
                    inventoryQuantity:
                      Number(variant.inventoryQuantity) > 0
                        ? Math.floor(Number(variant.inventoryQuantity))
                        : 0,
                    optionValues: variant.optionValues,
                    prices: buildPrices(variant.prices),
                  }))
              : undefined,
          },
        });

        if (!result.success) {
          toast.error(result.message, { id: toastId, position: "top-center" });
          return;
        }

        void queryClient.invalidateQueries({ queryKey: productQueries.all() });
        toast.success(result.message, { id: toastId, position: "top-center" });
        close();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create product",
          { id: toastId, position: "top-center" },
        );
      } finally {
        setPending(false);
      }
    },
    [close, detailsValid, draft, queryClient],
  );

  const isLastStep = step === STEPS.length - 1;

  // The shell mirrors the shared create window (`DialogCreateWrapper`): an
  // inset card over the dashboard rather than a bare full-bleed page, so both
  // create surfaces read as the same kind of thing.
  return (
    <div className="fixed inset-0 z-50 flex p-2">
      <div
        className={cn(
          createSurface.shell,
          "min-h-0 flex-1 overflow-hidden rounded-lg dark:shadow-elevation-modal",
        )}
      >
        <header className={cn(createSurface.header, "flex items-center")}>
          <div className="flex items-center gap-2 px-4">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={close}
            >
              <X className="size-4" />
            </Button>
            <kbd className="rounded border border-border/60 px-1.5 py-0.5 text-xs text-muted-foreground">
              esc
            </kbd>
          </div>

          <nav className="flex" aria-label="Product creation steps">
            {STEPS.map((label, index) => {
              const isActive = index === step;
              const isDone = index < step;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(index as StepIndex)}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 border-x border-border/60 px-6 py-4 text-sm transition-colors",
                    isActive
                      ? "bg-muted/40 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <CircleDashed
                      className={cn("size-4", isActive && "text-primary")}
                    />
                  )}
                  {label}
                </button>
              );
            })}
          </nav>
        </header>

        <main className={cn(createSurface.body, "overflow-y-auto")}>
          {step === 0 && <StepDetails draft={draft} dispatch={dispatch} />}
          {step === 1 && <StepOrganize draft={draft} dispatch={dispatch} />}
          {step === 2 && <StepVariants draft={draft} dispatch={dispatch} />}
        </main>

        <footer className={createSurface.footer}>
          <DialogFooterActions
            isSheet={false}
            isLoading={pending}
            onCancel={close}
            className="w-full justify-end"
            submitLabel={isLastStep ? "Publish" : "Continue"}
            loadingLabel="Creating..."
            onSubmit={
              isLastStep
                ? () => void submit("published")
                : () => setStep((step + 1) as StepIndex)
            }
            // Saving a draft is available at every step, so it sits in the
            // submit button's dropdown rather than as a third button.
            additionalActions={[
              { label: "Save as draft", onClick: () => void submit("draft") },
            ]}
          />
        </footer>
      </div>
    </div>
  );
};

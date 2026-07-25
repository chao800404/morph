import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ProductStatus } from "@/db/product.schema";
import { createProduct } from "@/server/product";
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
      draft.options.some(
        (option) => option.title.trim() !== "" && option.values.length > 0,
      ));

  const submit = useCallback(
    async (status: ProductStatus) => {
      if (!detailsValid) {
        setStep(0);
        toast.error("Add a title, and at least one option with values.", {
          position: "top-center",
        });
        return;
      }

      setPending(true);
      const toastId = toast.loading("Creating product...", {
        position: "top-center",
      });

      try {
        const options = draft.hasVariants
          ? draft.options
              .filter(
                (option) =>
                  option.title.trim() !== "" && option.values.length > 0,
              )
              .map((option) => ({
                title: option.title.trim(),
                values: option.values,
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center border-b border-border/60">
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

      <main className="flex-1 overflow-y-auto">
        {step === 0 && <StepDetails draft={draft} dispatch={dispatch} />}
        {step === 1 && <StepOrganize draft={draft} dispatch={dispatch} />}
        {step === 2 && <StepVariants draft={draft} dispatch={dispatch} />}
      </main>

      <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-6 py-3">
        {pending && <Spinner />}
        <Button variant="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={() => void submit("draft")}
          disabled={pending}
        >
          Save as draft
        </Button>
        {isLastStep ? (
          <Button
            variant="form"
            onClick={() => void submit("published")}
            disabled={pending}
          >
            Publish
          </Button>
        ) : (
          <Button
            variant="form"
            onClick={() => setStep((step + 1) as StepIndex)}
            disabled={pending}
          >
            Continue
          </Button>
        )}
      </footer>
    </div>
  );
};

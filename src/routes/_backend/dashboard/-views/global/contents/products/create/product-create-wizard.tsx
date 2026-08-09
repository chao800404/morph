import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import {
  useCloseOnEscape,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toMinorUnits } from "@/lib/currency/catalog";
import type { ProductStatus } from "@/db/product.schema";
import { createProduct } from "@/server/product/create-product.serverFn";
import { currencyQueries } from "@queries/currency.queries";
import { productQueries } from "@queries/product.queries";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { StepDetails } from "./step-details";
import { StepOrganize } from "./step-organize";
import { StepVariants } from "./step-variants";
import { useProductDraft } from "./use-product-draft";
import { useSeededDraft } from "./use-seeded-draft";

const STEPS = ["Details", "Organize", "Variants"] as const;
type StepIndex = 0 | 1 | 2;

const ProductCreateWizard = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const currencyResult = useSuspenseQuery(currencyQueries.store()).data;
  const storeCurrencies = currencyResult.success
    ? currencyResult.data.supportedCurrencies
    : [];
  const [draft, dispatch] = useProductDraft(
    storeCurrencies.map((currency) => currency.code),
  );
  const [step, setStep] = useState<StepIndex>(0);
  const [pending, setPending] = useState(false);

  useCloseOnEscape(close);
  useSeededDraft(dispatch);

  /**
   * What Details is still missing, keyed by the field that shows it.
   *
   * Later steps build on these — Variants has nothing to price without an
   * option — so the wizard will not move forward until they are answered.
   */
  const detailsIssues = useMemo(() => {
    const issues: { title?: string; options?: string } = {};
    if (draft.title.trim() === "") {
      issues.title = "Title is required";
    }
    if (
      draft.hasVariants &&
      !draft.options.some((option) => option.selectedValueIds.length > 0)
    ) {
      issues.options =
        "Pick an option and at least one of its values, or turn variants off";
    }
    return issues;
  }, [draft.title, draft.hasVariants, draft.options]);

  const detailsValid = Object.keys(detailsIssues).length === 0;

  // Messages stay hidden until the author tries to leave the step, so a form
  // they have not filled in yet is not already covered in red.
  const [showDetailsIssues, setShowDetailsIssues] = useState(false);

  /**
   * Going back is always allowed; going forward is not.
   *
   * The button stays enabled and reveals what is missing on click — a disabled
   * Continue with no explanation leaves the author guessing.
   */
  const goToStep = useCallback(
    (next: StepIndex) => {
      if (next > 0 && !detailsValid) {
        setShowDetailsIssues(true);
        setStep(0);
        return false;
      }
      setStep(next);
      return true;
    },
    [detailsValid],
  );

  const submit = useCallback(
    async (status: ProductStatus) => {
      // Save as draft is reachable from any step, so submitting is gated too.
      if (!detailsValid) {
        setShowDetailsIssues(true);
        setStep(0);
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
                  .filter((value) => option.selectedValueIds.includes(value.id))
                  .map((value) => value.id),
              }))
          : [];

        const buildPrices = (prices: Record<string, string>) =>
          storeCurrencies
            .map((currency) => ({
              currencyCode: currency.code,
              amount: toMinorUnits(prices[currency.code] ?? "", currency),
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
            typeValue: draft.typeValue.trim() || null,
            tagValues: draft.tagValues,
            categoryIds: draft.categoryIds,
            salesChannelIds: draft.salesChannelIds,
            // Order matters: the first image becomes the thumbnail, derived
            // server-side by `setAssets`.
            assetIds: draft.assets.map((asset) => asset.id),
            discountable: draft.discountable,
            options,
            prices: [],
            variants: (draft.hasVariants
              ? draft.variants.filter((variant) => variant.included)
              : [draft.defaultVariant]
            ).map((variant) => ({
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
            })),
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
    [close, detailsValid, draft, queryClient, storeCurrencies],
  );

  const isLastStep = step === STEPS.length - 1;

  const selectStep = (value: string) => {
    const next = Number(value);
    if (next === 0 || next === 1 || next === 2) {
      goToStep(next);
    }
  };

  return (
    <Tabs value={String(step)} onValueChange={selectStep} className="contents">
      <RouteFullscreenSurface
        onClose={close}
        bodyClassName="overflow-y-auto"
        headerLeading={
          <TabsList variant="wizard" aria-label="Product creation steps">
            {STEPS.map((label, index) => {
              const isActive = index === step;
              const isDone = index < step;
              return (
                <TabsTrigger
                  key={label}
                  value={String(index)}
                  variant="wizard"
                  aria-current={isActive ? "step" : undefined}
                >
                  {isDone ? (
                    <CheckCircle2 className="size-4 text-emerald-500 dark:text-emerald-400" />
                  ) : (
                    <CircleDashed
                      className={cn("size-4", isActive && "text-primary")}
                    />
                  )}
                  {label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        }
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={pending}
            onCancel={close}
            submitLabel={isLastStep ? "Publish" : "Continue"}
            loadingLabel="Creating..."
            onSubmit={
              isLastStep
                ? () => void submit("published")
                : () => goToStep((step + 1) as StepIndex)
            }
            additionalActions={[
              { label: "Save as draft", onClick: () => void submit("draft") },
            ]}
          />
        }
      >
        <TabsContent value="0" className="m-0 h-full">
          <StepDetails
            draft={draft}
            dispatch={dispatch}
            issues={showDetailsIssues ? detailsIssues : {}}
          />
        </TabsContent>
        <TabsContent value="1" className="m-0 h-full">
          <StepOrganize draft={draft} dispatch={dispatch} />
        </TabsContent>
        <TabsContent value="2" className="m-0 h-full">
          <StepVariants
            draft={draft}
            dispatch={dispatch}
            currencies={storeCurrencies}
          />
        </TabsContent>
      </RouteFullscreenSurface>
    </Tabs>
  );
};

export default ProductCreateWizard;

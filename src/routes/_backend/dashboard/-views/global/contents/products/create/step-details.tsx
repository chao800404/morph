import { createSurface } from "@/components/dialog/create-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Dispatch } from "react";
import { OptionPicker } from "./option-picker";
import type { DraftAction, ProductDraft } from "./use-product-draft";
import { VariantMatrix } from "./variant-matrix";

export const StepDetails = ({
  draft,
  dispatch,
}: {
  draft: ProductDraft;
  dispatch: Dispatch<DraftAction>;
}) => (
  <div className={cn(createSurface.content, "flex w-full flex-col gap-10")}>
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-foreground">General</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="product-title">Title</Label>
          <Input
            id="product-title"
            variant="card"
            autoFocus
            value={draft.title}
            onChange={(event) =>
              dispatch({
                type: "setField",
                field: "title",
                value: event.target.value,
              })
            }
            placeholder="e.g. Summer T-Shirt"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-subtitle">
            Subtitle{" "}
            <span className="text-muted-foreground">(Optional)</span>
          </Label>
          <Input
            id="product-subtitle"
            variant="card"
            value={draft.subtitle}
            onChange={(event) =>
              dispatch({
                type: "setField",
                field: "subtitle",
                value: event.target.value,
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-handle">
            Handle <span className="text-muted-foreground">(Optional)</span>
          </Label>
          <Input
            id="product-handle"
            variant="card"
            value={draft.handle}
            onChange={(event) =>
              dispatch({
                type: "setField",
                field: "handle",
                value: event.target.value,
              })
            }
            placeholder="Derived from the title"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-description">
          Description <span className="text-muted-foreground">(Optional)</span>
        </Label>
        <Textarea
          id="product-description"
          variant="card"
          rows={4}
          value={draft.description}
          onChange={(event) =>
            dispatch({
              type: "setField",
              field: "description",
              value: event.target.value,
            })
          }
        />
      </div>
    </section>

    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-foreground">Variants</h2>

      <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <Switch
          id="has-variants"
          checked={draft.hasVariants}
          onCheckedChange={(checked) =>
            dispatch({ type: "setHasVariants", value: checked })
          }
        />
        <div className="space-y-1">
          <Label htmlFor="has-variants" className="font-medium">
            Yes, this is a product with variants
          </Label>
          <p className="text-sm text-muted-foreground">
            When off, a single default variant is created for you.
          </p>
        </div>
      </div>

      {draft.hasVariants && (
        <div className="flex flex-col gap-6">
          <OptionPicker options={draft.options} dispatch={dispatch} />
          {draft.variants.length > 0 && (
            <VariantMatrix
              options={draft.options}
              variants={draft.variants}
              dispatch={dispatch}
            />
          )}
        </div>
      )}
    </section>
  </div>
);

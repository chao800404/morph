import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { OptionValuesField } from "@/components/form/option-values-field";
import { Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import type { DraftAction, ProductDraft } from "./use-product-draft";

const MAX_OPTIONS = 3;

export const StepDetails = ({
  draft,
  dispatch,
}: {
  draft: ProductDraft;
  dispatch: Dispatch<DraftAction>;
}) => (
  <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 py-10">
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
          <div className="space-y-1">
            <h3 className="font-medium text-foreground">Product options</h3>
            <p className="text-sm text-muted-foreground">
              Define the options for the product, e.g. colour, size.
            </p>
          </div>

          {draft.options.map((option, index) => (
            <div
              key={option.key}
              className="flex flex-col gap-3 rounded-lg border border-border/60 p-4"
            >
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor={`option-title-${option.key}`}>
                    Option {index + 1}
                  </Label>
                  <Input
                    id={`option-title-${option.key}`}
                    variant="card"
                    value={option.title}
                    onChange={(event) =>
                      dispatch({
                        type: "setOptionTitle",
                        key: option.key,
                        title: event.target.value,
                      })
                    }
                    placeholder="e.g. Size"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() =>
                    dispatch({ type: "removeOption", key: option.key })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Values</Label>
                <OptionValuesField
                  name={`option-values-${option.key}`}
                  value={option.values}
                  defaultValue={option.values}
                  onChange={(_name, values) =>
                    dispatch({
                      type: "setOptionValues",
                      key: option.key,
                      values,
                    })
                  }
                />
              </div>
            </div>
          ))}

          {draft.options.length < MAX_OPTIONS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => dispatch({ type: "addOption" })}
            >
              Add option
            </Button>
          )}

          {draft.variants.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="space-y-1">
                <h3 className="font-medium text-foreground">
                  Product variants
                </h3>
                <p className="text-sm text-muted-foreground">
                  Uncheck a combination to leave it out. Ranking follows this
                  order in your storefront.
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-border/60">
                <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2.5">
                  <Checkbox
                    checked={draft.variants.every((v) => v.included)}
                    aria-label="Toggle all variants"
                    onCheckedChange={(checked) =>
                      dispatch({
                        type: "toggleAllVariants",
                        included: checked === true,
                      })
                    }
                  />
                  {draft.options
                    .filter((o) => o.title.trim() !== "")
                    .map((option) => (
                      <span
                        key={option.key}
                        className="flex-1 text-sm font-medium text-foreground"
                      >
                        {option.title}
                      </span>
                    ))}
                </div>
                <div className="divide-y divide-border/40">
                  {draft.variants.map((variant) => (
                    <div
                      key={variant.key}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <Checkbox
                        checked={variant.included}
                        aria-label={`Include ${variant.key}`}
                        onCheckedChange={(checked) =>
                          dispatch({
                            type: "toggleVariant",
                            key: variant.key,
                            included: checked === true,
                          })
                        }
                      />
                      {variant.optionValues.map((value, index) => (
                        <span
                          key={`${variant.key}-${index}`}
                          className="flex-1 text-sm"
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  </div>
);

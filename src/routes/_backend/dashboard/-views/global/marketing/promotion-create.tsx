import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import {
  useCloseOnEscape,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { FormField, FormFieldValue } from "@/lib/validations/form";
import { createPromotion } from "@/server/marketing/promotions.serverFn";
import { promotionQueries } from "@queries/marketing.queries";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { promotionCommonFields } from "./config/promotion-form-fields";

const STEPS = ["Type", "Details", "Campaign"] as const;
type StepIndex = 0 | 1 | 2;
type TemplateId =
  | "amount_off_products"
  | "amount_off_order"
  | "percentage_off_product"
  | "percentage_off_order"
  | "buy_get"
  | "shipping_discount";
type RuleDraft = {
  id: string;
  attribute: string;
  operator: "gte" | "lte" | "gt" | "lt" | "eq" | "ne" | "in";
  values: string;
};

const TEMPLATES: Array<{ id: TemplateId; title: string; description: string }> =
  [
    {
      id: "amount_off_products",
      title: "Amount off products",
      description: "Discount specific products by a fixed amount.",
    },
    {
      id: "amount_off_order",
      title: "Amount off order",
      description: "Discount the entire order by a fixed amount.",
    },
    {
      id: "percentage_off_product",
      title: "Percentage off products",
      description: "Discount specific products by a percentage.",
    },
    {
      id: "percentage_off_order",
      title: "Percentage off order",
      description: "Discount the entire order by a percentage.",
    },
    {
      id: "buy_get",
      title: "Buy X get Y",
      description: "Reward qualifying purchases with discounted products.",
    },
    {
      id: "shipping_discount",
      title: "Shipping discount",
      description: "Offer free or discounted shipping.",
    },
  ];

const templateDefaults = (template: TemplateId) => {
  if (template === "amount_off_products")
    return {
      type: "standard" as const,
      methodType: "fixed" as const,
      targetType: "items" as const,
      allocation: "each" as const,
      value: "",
      taxVisible: true,
    };
  if (template === "amount_off_order")
    return {
      type: "standard" as const,
      methodType: "fixed" as const,
      targetType: "order" as const,
      allocation: "across" as const,
      value: "",
      taxVisible: true,
    };
  if (template === "percentage_off_product")
    return {
      type: "standard" as const,
      methodType: "percentage" as const,
      targetType: "items" as const,
      allocation: "each" as const,
      value: "",
      taxVisible: false,
    };
  if (template === "percentage_off_order")
    return {
      type: "standard" as const,
      methodType: "percentage" as const,
      targetType: "order" as const,
      allocation: "across" as const,
      value: "",
      taxVisible: false,
    };
  if (template === "buy_get")
    return {
      type: "buyget" as const,
      methodType: "percentage" as const,
      targetType: "items" as const,
      allocation: "each" as const,
      value: "100",
      taxVisible: false,
    };
  return {
    type: "standard" as const,
    methodType: "percentage" as const,
    targetType: "shipping_methods" as const,
    allocation: "across" as const,
    value: "100",
    taxVisible: false,
  };
};

const RulesEditor = ({
  label,
  description,
  rules,
  onChange,
}: {
  label: string;
  description: string;
  rules: RuleDraft[];
  onChange: (rules: RuleDraft[]) => void;
}) => {
  const update = (id: string, patch: Partial<RuleDraft>) =>
    onChange(
      rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  return (
    <section className="space-y-3 border-t pt-8">
      <div>
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {rules.map((rule) => (
        <div
          key={rule.id}
          className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-end gap-3 max-md:grid-cols-1"
        >
          <FieldsRenderer
            className="grid-cols-3 max-md:grid-cols-1"
            fields={[
              {
                type: "input",
                name: "attribute",
                label: "Attribute",
                value: rule.attribute,
                placeholder: "e.g. customer_group_id",
                colSpan: 1,
              },
              {
                type: "select",
                name: "operator",
                label: "Operator",
                value: rule.operator,
                options: ["in", "eq", "ne", "gte", "lte", "gt", "lt"].map(
                  (value) => ({ label: value, value }),
                ),
                colSpan: 1,
              },
              {
                type: "input",
                name: "values",
                label: "Values",
                value: rule.values,
                placeholder: "Comma separated",
                colSpan: 1,
              },
            ]}
            onChange={(name, value) => {
              if (typeof value !== "string") return;
              if (name === "operator")
                update(rule.id, { operator: value as RuleDraft["operator"] });
              else update(rule.id, { [name]: value });
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() =>
              onChange(rules.filter((item) => item.id !== rule.id))
            }
            aria-label="Remove rule"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...rules,
            {
              id: crypto.randomUUID(),
              attribute: "",
              operator: "in",
              values: "",
            },
          ])
        }
      >
        <Plus className="size-4" />
        Add condition
      </Button>
    </section>
  );
};

const PromotionCreate = () => {
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  useCloseOnEscape(close);
  const [step, setStep] = useState<StepIndex>(0);
  const [pending, setPending] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [template, setTemplate] = useState<TemplateId>("amount_off_products");
  const defaults = useMemo(() => templateDefaults(template), [template]);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"draft" | "active">("draft");
  const [automatic, setAutomatic] = useState(false);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [limit, setLimit] = useState("");
  const [maxQuantity, setMaxQuantity] = useState("");
  const [applyToQuantity, setApplyToQuantity] = useState("1");
  const [buyMinQuantity, setBuyMinQuantity] = useState("1");
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [targetRules, setTargetRules] = useState<RuleDraft[]>([]);
  const [buyRules, setBuyRules] = useState<RuleDraft[]>([]);
  const [campaignChoice, setCampaignChoice] = useState<
    "none" | "existing" | "new"
  >("none");
  const [campaignId, setCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignIdentifier, setCampaignIdentifier] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [budgetType, setBudgetType] = useState<
    "usage" | "spend" | "use_by_attribute" | "spend_by_attribute"
  >("usage");
  const [budgetLimit, setBudgetLimit] = useState("");
  const [budgetAttribute, setBudgetAttribute] = useState("");

  const detailIssues = useMemo(
    () => ({
      code: code.trim() ? undefined : "Code is required",
      value:
        Number(value || defaults.value) >= 0 &&
        String(value || defaults.value) !== ""
          ? undefined
          : "Value is required",
    }),
    [code, defaults.value, value],
  );
  const detailsValid = !detailIssues.code && !detailIssues.value;
  const campaignValid =
    campaignChoice !== "new" ||
    (campaignName.trim() !== "" && campaignIdentifier.trim() !== "");
  const commonFields = promotionCommonFields({
    mode: "create",
    code,
    status,
    isAutomatic: automatic,
    value: value || defaults.value,
    currencyCode: currency,
    limit,
    maxQuantity,
    isTaxInclusive: taxInclusive,
    valueLabel: defaults.methodType === "percentage" ? "Percentage" : "Amount",
    codeError: showIssues ? detailIssues.code : undefined,
    valueError: showIssues ? detailIssues.value : undefined,
    includeCurrency: defaults.methodType === "fixed",
    includeMaxQuantity: defaults.allocation !== "across",
    includeTaxInclusive: defaults.taxVisible,
  });
  const detailFields: FormField[] = [
    ...commonFields.filter(
      (field) => field.name !== "status" && field.name !== "isAutomatic",
    ),
    ...(template === "buy_get"
      ? [
          {
            type: "input" as const,
            name: "buyMinQuantity",
            label: "Minimum quantity to buy",
            inputType: "number",
            value: buyMinQuantity,
            colSpan: 1,
          },
          {
            type: "input" as const,
            name: "applyToQuantity",
            label: "Quantity customer gets",
            inputType: "number",
            value: applyToQuantity,
            colSpan: 1,
          },
        ]
      : []),
  ];
  const campaignFields: FormField[] =
    campaignChoice === "existing"
      ? [
          {
            type: "remote-select",
            name: "campaignId",
            label: "Campaign",
            value: campaignId,
            remoteSource: "promotion-campaigns",
            searchPlaceholder: "Search campaigns...",
            emptyMessage: "No campaigns found.",
          },
        ]
      : campaignChoice === "new"
        ? [
            {
              type: "input",
              name: "campaignName",
              label: "Name",
              value: campaignName,
              colSpan: 1,
            },
            {
              type: "input",
              name: "campaignIdentifier",
              label: "Identifier",
              value: campaignIdentifier,
              colSpan: 1,
            },
            {
              type: "input",
              name: "campaignDescription",
              label: "Description",
              value: campaignDescription,
              optional: true,
              colSpan: 1,
            },
            {
              type: "select",
              name: "budgetType",
              label: "Budget type",
              value: budgetType,
              colSpan: 1,
              options: [
                { label: "Usage", value: "usage" },
                { label: "Spend", value: "spend" },
                { label: "Usage per customer", value: "use_by_attribute" },
                { label: "Spend per customer", value: "spend_by_attribute" },
              ],
            },
            {
              type: "input",
              name: "startsAt",
              label: "Starts at",
              inputType: "datetime-local",
              value: startsAt,
              optional: true,
              colSpan: 1,
            },
            {
              type: "input",
              name: "endsAt",
              label: "Ends at",
              inputType: "datetime-local",
              value: endsAt,
              optional: true,
              colSpan: 1,
            },
            {
              type: "input",
              name: "budgetLimit",
              label: "Budget limit",
              inputType: "number",
              value: budgetLimit,
              optional: true,
              colSpan: 1,
            },
            ...(budgetType.includes("attribute")
              ? [
                  {
                    type: "input" as const,
                    name: "budgetAttribute",
                    label: "Customer attribute",
                    value: budgetAttribute,
                    placeholder: "customer_id",
                    colSpan: 1,
                  },
                ]
              : []),
          ]
        : [];
  const templateField: FormField[] = [
    {
      type: "choice-cards",
      name: "template",
      label: "Promotion type",
      value: template,
      options: TEMPLATES.map((item) => ({
        label: item.title,
        value: item.id,
        description: item.description,
      })),
    },
  ];
  const methodField = commonFields.filter(
    (field) => field.name === "isAutomatic",
  );
  const statusField = commonFields.filter((field) => field.name === "status");
  const campaignChoiceField: FormField[] = [
    {
      type: "choice-cards",
      name: "campaignChoice",
      label: "Campaign",
      value: campaignChoice,
      options: [
        {
          label: "No campaign",
          value: "none",
          description: "Create the promotion without a campaign.",
        },
        {
          label: "Existing campaign",
          value: "existing",
          description: "Add the promotion to an existing campaign.",
        },
        {
          label: "New campaign",
          value: "new",
          description: "Create a campaign together with this promotion.",
        },
      ],
    },
  ];
  const updateDetailField = (name: string, next: FormFieldValue | File[]) => {
    if (name === "isTaxInclusive" && typeof next === "boolean")
      return setTaxInclusive(next);
    if (typeof next !== "string") return;
    const setters: Record<string, (value: string) => void> = {
      code: (item) => setCode(item.toUpperCase()),
      value: setValue,
      currencyCode: (item) => setCurrency(item.toLowerCase()),
      limit: setLimit,
      maxQuantity: setMaxQuantity,
      buyMinQuantity: setBuyMinQuantity,
      applyToQuantity: setApplyToQuantity,
    };
    setters[name]?.(next);
  };
  const updateCampaignField = (name: string, next: FormFieldValue | File[]) => {
    if (typeof next !== "string") return;
    const setters: Record<string, (value: string) => void> = {
      campaignId: setCampaignId,
      campaignName: setCampaignName,
      campaignIdentifier: setCampaignIdentifier,
      campaignDescription: setCampaignDescription,
      startsAt: setStartsAt,
      endsAt: setEndsAt,
      budgetLimit: setBudgetLimit,
      budgetAttribute: setBudgetAttribute,
      budgetType: (item) => setBudgetType(item as typeof budgetType),
    };
    setters[name]?.(next);
  };
  const goToStep = useCallback(
    (next: StepIndex) => {
      if (next > 1 && !detailsValid) {
        setShowIssues(true);
        setStep(1);
        return;
      }
      setStep(next);
    },
    [detailsValid],
  );
  const serializeRules = (items: RuleDraft[]) =>
    items
      .filter((rule) => rule.attribute.trim() && rule.values.trim())
      .map((rule) => ({
        attribute: rule.attribute.trim(),
        operator: rule.operator,
        values: rule.values
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }));

  const submit = async () => {
    if (!detailsValid) {
      setShowIssues(true);
      setStep(1);
      return;
    }
    if (!campaignValid) {
      toast.error("Campaign name and identifier are required", {
        position: "top-center",
      });
      setStep(2);
      return;
    }
    setPending(true);
    const toastId = toast.loading("Creating promotion...", {
      position: "top-center",
    });
    try {
      const result = await createPromotion({
        data: {
          code,
          type: defaults.type,
          status,
          isAutomatic: automatic,
          isTaxInclusive: defaults.taxVisible ? taxInclusive : false,
          limit: limit ? Number(limit) : undefined,
          methodType: defaults.methodType,
          targetType: defaults.targetType,
          allocation: defaults.allocation,
          value: Number(value || defaults.value),
          currencyCode: defaults.methodType === "fixed" ? currency : undefined,
          maxQuantity: maxQuantity ? Number(maxQuantity) : undefined,
          applyToQuantity:
            template === "buy_get" ? Number(applyToQuantity) : undefined,
          buyRulesMinQuantity:
            template === "buy_get" ? Number(buyMinQuantity) : undefined,
          rules: serializeRules(rules),
          targetRules: serializeRules(targetRules),
          buyRules: serializeRules(buyRules),
          campaignId:
            campaignChoice === "existing" && campaignId
              ? campaignId
              : undefined,
          campaign:
            campaignChoice === "new"
              ? {
                  name: campaignName,
                  description: campaignDescription || undefined,
                  identifier: campaignIdentifier,
                  startsAt: startsAt || undefined,
                  endsAt: endsAt || undefined,
                  budgetType,
                  budgetLimit: budgetLimit ? Number(budgetLimit) : undefined,
                  budgetCurrencyCode: budgetType.includes("spend")
                    ? currency
                    : undefined,
                  budgetAttribute: budgetAttribute || undefined,
                }
              : undefined,
        },
      });
      if (!result.success) {
        toast.error(result.message, { id: toastId, position: "top-center" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: promotionQueries.all() });
      toast.success(result.message, { id: toastId, position: "top-center" });
      close();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create promotion",
        { id: toastId, position: "top-center" },
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Tabs
      value={String(step)}
      onValueChange={(next) => goToStep(Number(next) as StepIndex)}
      className="contents"
    >
      <RouteFullscreenSurface
        onClose={close}
        bodyClassName="overflow-y-auto"
        headerLeading={
          <TabsList variant="wizard" aria-label="Promotion creation steps">
            {STEPS.map((label, index) => {
              const done = index < step;
              return (
                <TabsTrigger
                  key={label}
                  value={String(index)}
                  variant="wizard"
                  aria-current={index === step ? "step" : undefined}
                >
                  {done ? (
                    <CheckCircle2 className="size-4 text-emerald-500 dark:text-emerald-400" />
                  ) : (
                    <CircleDashed
                      className={cn("size-4", index === step && "text-primary")}
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
            submitLabel={step === 2 ? "Create" : "Continue"}
            loadingLabel="Creating..."
            onSubmit={
              step === 2
                ? () => void submit()
                : () => goToStep((step + 1) as StepIndex)
            }
          />
        }
      >
        <TabsContent value="0" className="m-0 h-full">
          <div className="mx-auto w-full max-w-[720px] space-y-6 py-12">
            <div>
              <h2 className="text-lg font-medium">Promotion type</h2>
              <p className="text-sm text-muted-foreground">
                Choose the discount template. Its application method is
                configured automatically.
              </p>
            </div>
            <FieldsRenderer
              fields={templateField}
              onChange={(_name, next) => {
                if (typeof next !== "string") return;
                const selected = next as TemplateId;
                setTemplate(selected);
                setValue(templateDefaults(selected).value);
              }}
            />
          </div>
        </TabsContent>
        <TabsContent value="1" className="m-0 h-full">
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 py-12">
            <div>
              <h2 className="text-lg font-medium">Promotion details</h2>
              <p className="text-sm text-muted-foreground">
                {TEMPLATES.find((item) => item.id === template)?.title}
              </p>
            </div>
            <FieldsRenderer
              fields={methodField}
              onChange={(_name, next) => {
                if (typeof next === "string")
                  setAutomatic(next === "automatic");
              }}
            />
            <FieldsRenderer
              fields={statusField}
              onChange={(_name, next) => {
                if (next === "draft" || next === "active") setStatus(next);
              }}
            />
            <FieldsRenderer
              fields={detailFields}
              className="max-sm:grid-cols-1"
              onChange={updateDetailField}
            />
            <RulesEditor
              label="Promotion conditions"
              description="Define who or what is eligible for this promotion."
              rules={rules}
              onChange={setRules}
            />
            {defaults.targetType === "items" ? (
              <RulesEditor
                label="Target products"
                description="Define which products receive the discount."
                rules={targetRules}
                onChange={setTargetRules}
              />
            ) : null}
            {template === "buy_get" ? (
              <RulesEditor
                label="Buy conditions"
                description="Define which products must be purchased first."
                rules={buyRules}
                onChange={setBuyRules}
              />
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="2" className="m-0 h-full">
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 py-12">
            <div>
              <h2 className="text-lg font-medium">Campaign</h2>
              <p className="text-sm text-muted-foreground">
                Optionally organize the promotion in a campaign with dates and a
                budget.
              </p>
            </div>
            <FieldsRenderer
              fields={campaignChoiceField}
              onChange={(_name, next) => {
                if (next === "none" || next === "existing" || next === "new")
                  setCampaignChoice(next);
              }}
            />
            {campaignFields.length > 0 ? (
              <FieldsRenderer
                fields={campaignFields}
                className="max-sm:grid-cols-1"
                onChange={updateCampaignField}
              />
            ) : null}
          </div>
        </TabsContent>
      </RouteFullscreenSurface>
    </Tabs>
  );
};

export default PromotionCreate;

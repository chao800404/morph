import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ShippingRuleFormValue,
  ShippingRulesFormField,
} from "@/lib/validations/form";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

const attributes: Array<{
  value: ShippingRuleFormValue["attribute"];
  label: string;
  numeric: boolean;
}> = [
  { value: "item_count", label: "Cart item count", numeric: true },
  { value: "subtotal", label: "Cart subtotal (minor currency units)", numeric: true },
  { value: "total", label: "Cart total (minor currency units)", numeric: true },
  { value: "currency_code", label: "Currency code", numeric: false },
  { value: "region_id", label: "Region ID", numeric: false },
  { value: "sales_channel_id", label: "Sales channel ID", numeric: false },
];

const numericOperators: Array<{
  value: ShippingRuleFormValue["operator"];
  label: string;
}> = [
  { value: "eq", label: "is equal to" },
  { value: "ne", label: "is not equal to" },
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
];

const textOperators: Array<{
  value: ShippingRuleFormValue["operator"];
  label: string;
}> = [
  { value: "eq", label: "is" },
  { value: "ne", label: "is not" },
  { value: "in", label: "is one of" },
  { value: "nin", label: "is not one of" },
];

const isAttribute = (
  value: unknown,
): value is ShippingRuleFormValue["attribute"] =>
  typeof value === "string" &&
    attributes.some((attribute) => attribute.value === value);

const isOperator = (
  value: unknown,
): value is ShippingRuleFormValue["operator"] =>
  ["in", "eq", "ne", "gt", "gte", "lt", "lte", "nin"].includes(
    String(value),
  );

const isNumericAttribute = (value: ShippingRuleFormValue["attribute"]) =>
  attributes.find((attribute) => attribute.value === value)?.numeric ?? false;

const parseRules = (raw: string): ShippingRuleFormValue[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const rule = item as Partial<ShippingRuleFormValue>;
      if (
        !isAttribute(rule.attribute) ||
        !isOperator(rule.operator) ||
        rule.value === undefined
      ) {
        return [];
      }
      return [
        {
          attribute: rule.attribute,
          operator: rule.operator,
          value: isNumericAttribute(rule.attribute)
            ? String(rule.value)
            : rule.value,
        } as ShippingRuleFormValue,
      ];
    });
  } catch {
    return [];
  }
};

const isListOperator = (operator: ShippingRuleFormValue["operator"]) =>
  operator === "in" || operator === "nin";

const parseListValue = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const displayValue = (rule: ShippingRuleFormValue) =>
  Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value);

const ruleId = (id: string, index: number, part: string) =>
  `${id}-rule-${index}-${part}`;

export const ShippingRulesField = ({
  field,
  fieldId: id,
  value,
  onChange,
}: {
  field: ShippingRulesFormField;
  fieldId: string;
  value: string;
  onChange?: (value: string) => void;
}) => {
  const [rules, setRules] = useState(() => parseRules(value));
  const serialized = JSON.stringify(rules);
  const maxRules = field.maxRules ?? 20;

  useEffect(() => {
    setRules(parseRules(value));
  }, [value]);

  const commit = (next: ShippingRuleFormValue[]) => {
    setRules(next);
    onChange?.(JSON.stringify(next));
  };

  const update = (
    index: number,
    transform: (current: ShippingRuleFormValue) => ShippingRuleFormValue,
  ) =>
    commit(
      rules.map((rule, ruleIndex) =>
        ruleIndex === index ? transform(rule) : rule,
      ),
    );

  const addRule = () => {
    if (rules.length >= maxRules) return;
    commit([
      ...rules,
      { attribute: "item_count", operator: "gte", value: "1" },
    ]);
  };

  return (
    <fieldset
      className="space-y-3"
      aria-describedby={
        field.error
          ? `${id}-error`
          : field.description
            ? `${id}-description`
            : undefined
      }
    >
      <legend className="text-sm font-medium">
        {field.label}
        {field.optional ? (
          <span className="ml-1 font-normal text-muted-foreground">
            (Optional)
          </span>
        ) : null}
      </legend>
      {field.description ? (
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {field.description}
        </p>
      ) : null}
      {field.error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {field.error}
        </p>
      ) : null}
      <input type="hidden" name={field.name} value={serialized} />

      {rules.length ? (
        <div className="space-y-3">
          {rules.map((rule, index) => {
            const attribute = attributes.find(
              (item) => item.value === rule.attribute,
            )!;
            const operators = attribute.numeric
              ? numericOperators
              : textOperators;
            const operator = operators.find(
              (item) => item.value === rule.operator,
            );

            return (
              <section
                key={`${index}-${rule.attribute}`}
                className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
                aria-label={`Shipping rule ${index + 1}`}
              >
                <div className="min-w-0 space-y-2">
                  <Label
                    htmlFor={ruleId(id, index, "attribute")}
                    className="text-xs font-medium"
                  >
                    Attribute
                  </Label>
                  <Select
                    value={rule.attribute}
                    onValueChange={(next: ShippingRuleFormValue["attribute"]) => {
                      const nextAttribute = attributes.find(
                        (item) => item.value === next,
                      );
                      if (!nextAttribute) return;
                      update(index, () => ({
                        attribute: next,
                        operator: nextAttribute.numeric ? "gte" : "eq",
                        value: nextAttribute.numeric ? "1" : "",
                      }));
                    }}
                  >
                    <SelectTrigger
                      id={ruleId(id, index, "attribute")}
                      variant="card"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {attributes.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-2">
                  <Label
                    htmlFor={ruleId(id, index, "operator")}
                    className="text-xs font-medium"
                  >
                    Operator
                  </Label>
                  <Select
                    value={operator?.value}
                    onValueChange={(next: ShippingRuleFormValue["operator"]) =>
                      update(index, (current) => {
                        const nextIsList = isListOperator(next);
                        const wasList = isListOperator(current.operator);
                        const currentText = displayValue(current);
                        return {
                          ...current,
                          operator: next,
                          value: attribute.numeric
                            ? String(current.value)
                            : nextIsList
                              ? wasList
                                ? (current.value as string[])
                                : parseListValue(currentText)
                              : wasList
                                ? ((current.value as string[])[0] ?? "")
                                : currentText,
                        };
                      })
                    }
                  >
                    <SelectTrigger
                      id={ruleId(id, index, "operator")}
                      variant="card"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-2">
                  <Label
                    htmlFor={ruleId(id, index, "value")}
                    className="text-xs font-medium"
                  >
                    Value
                  </Label>
                  <Input
                    id={ruleId(id, index, "value")}
                    variant="card"
                    type={attribute.numeric ? "number" : "text"}
                    min={attribute.numeric ? 0 : undefined}
                    step={attribute.numeric ? 1 : undefined}
                    value={
                      displayValue(rule)
                    }
                    placeholder={
                      attribute.numeric
                        ? rule.attribute === "item_count"
                          ? "e.g. 2"
                          : "e.g. 1000 (USD 10.00)"
                        : isListOperator(rule.operator)
                          ? "Comma-separated values"
                          : rule.attribute === "currency_code"
                            ? "e.g. twd"
                            : "Enter an ID"
                    }
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      update(index, (current) => ({
                        ...current,
                        value: attribute.numeric
                          ? nextValue
                          : isListOperator(current.operator)
                            ? parseListValue(nextValue)
                            : nextValue,
                      }));
                    }}
                  />
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove shipping rule ${index + 1}`}
                  onClick={() => commit(rules.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          No rules. This option is available to every eligible cart in its service zone.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRule}
        disabled={rules.length >= maxRules}
      >
        <Plus className="mr-2 size-4" />
        Add rule
      </Button>
    </fieldset>
  );
};

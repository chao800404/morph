import { RouteFormPage, type RouteFormState } from "@/components/dialog/route-form-modal";
import type { StoreCurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type {
  FormFieldValue,
  OptionValueChoice,
} from "@/lib/validations/form";
import { useState } from "react";
import { locationShippingOptionFormFields } from "./location-shipping-option-form-fields";

export function LocationShippingOptionCreateForm(props: {
  title: string;
  description: string;
  serviceZoneId?: string;
  currencies: StoreCurrencyDTO[];
  countries: OptionValueChoice[];
  profiles: OptionValueChoice[];
  optionTypes: OptionValueChoice[];
  fulfillmentProviders: OptionValueChoice[];
  shippingRateProviders: OptionValueChoice[];
  action: (
    state: RouteFormState,
    formData: FormData,
  ) => Promise<RouteFormState>;
  submitLabel: string;
  loadingLabel: string;
}) {
  const [priceType, setPriceType] = useState<"flat" | "calculated">("flat");
  const [providerId, setProviderId] = useState("manual_manual");
  const [providerData, setProviderData] = useState("{}");
  const [rates, setRates] = useState<Record<string, string>>({});

  const handleFieldChange = (
    name: string,
    value: FormFieldValue | File[],
  ) => {
    if (name === "priceType" && (value === "flat" || value === "calculated")) {
      setPriceType(value);
      setProviderId("manual_manual");
    } else if (name === "providerId" && typeof value === "string") {
      setProviderId(value);
    } else if (name === "providerData" && typeof value === "string") {
      setProviderData(value);
    } else if (name.startsWith("rate_") && typeof value === "string") {
      setRates((current) => ({ ...current, [name]: value }));
    }
  };

  return (
    <RouteFormPage
      title={props.title}
      description={props.description}
      action={props.action}
      submitLabel={props.submitLabel}
      loadingLabel={props.loadingLabel}
      onFieldChange={handleFieldChange}
      fields={locationShippingOptionFormFields({
        currencies: props.currencies,
        countries: props.countries,
        profiles: props.profiles,
        optionTypes: props.optionTypes,
        providers: props.fulfillmentProviders,
        shippingRateProviders: props.shippingRateProviders,
        serviceZoneId: props.serviceZoneId,
        priceType,
        showPriceTypeSelector: true,
        showProviderSelector: true,
        current: { priceType, providerId, providerData, rates },
      })}
    />
  );
}

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AddressDTO } from "@/lib/order/dto/order.dto";

export interface DraftOrderAddress {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  phone: string;
}

export const emptyDraftOrderAddress = (): DraftOrderAddress => ({
  firstName: "",
  lastName: "",
  company: "",
  address1: "",
  address2: "",
  city: "",
  province: "",
  postalCode: "",
  countryCode: "",
  phone: "",
});

export const draftOrderAddressFromDTO = (
  address: AddressDTO | null,
): DraftOrderAddress => ({
  firstName: address?.firstName ?? "",
  lastName: address?.lastName ?? "",
  company: address?.company ?? "",
  address1: address?.address1 ?? "",
  address2: address?.address2 ?? "",
  city: address?.city ?? "",
  province: address?.province ?? "",
  postalCode: address?.postalCode ?? "",
  countryCode: address?.countryCode ?? "",
  phone: address?.phone ?? "",
});

export const serializeDraftOrderAddress = (
  address: DraftOrderAddress,
): DraftOrderAddress | null => {
  const normalized = Object.fromEntries(
    Object.entries(address).map(([key, value]) => [key, value.trim()]),
  ) as DraftOrderAddress;
  if (Object.values(normalized).every((value) => value.length === 0))
    return null;
  return {
    ...normalized,
    countryCode: normalized.countryCode.toLowerCase(),
  };
};

const fields: Array<{
  key: keyof DraftOrderAddress;
  label: string;
  maxLength: number;
  className?: string;
}> = [
  { key: "firstName", label: "First name", maxLength: 100 },
  { key: "lastName", label: "Last name", maxLength: 100 },
  { key: "company", label: "Company", maxLength: 200 },
  { key: "phone", label: "Phone", maxLength: 50 },
  { key: "address1", label: "Address line 1", maxLength: 300 },
  { key: "address2", label: "Address line 2", maxLength: 300 },
  { key: "city", label: "City", maxLength: 150 },
  { key: "province", label: "State / province", maxLength: 150 },
  { key: "postalCode", label: "Postal code", maxLength: 40 },
  { key: "countryCode", label: "Country code", maxLength: 2 },
];

export const DraftOrderAddressFields = ({
  idPrefix,
  address,
  onChange,
}: {
  idPrefix: string;
  address: DraftOrderAddress;
  onChange: (address: DraftOrderAddress) => void;
}) => (
  <div className="grid gap-3 sm:grid-cols-2">
    {fields.map((field) => {
      const id = `${idPrefix}-${field.key}`;
      return (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={id}>{field.label}</Label>
          <Input
            id={id}
            variant="card"
            value={address[field.key]}
            maxLength={field.maxLength}
            autoComplete={
              field.key === "firstName" || field.key === "lastName"
                ? field.key === "firstName"
                  ? "given-name"
                  : "family-name"
                : field.key === "address1"
                  ? "address-line1"
                  : field.key === "address2"
                    ? "address-line2"
                    : field.key === "city"
                      ? "address-level2"
                      : field.key === "province"
                        ? "address-level1"
                        : field.key === "postalCode"
                          ? "postal-code"
                          : field.key === "countryCode"
                            ? "country"
                            : field.key === "phone"
                              ? "tel"
                              : "organization"
            }
            onChange={(event) =>
              onChange({ ...address, [field.key]: event.target.value })
            }
          />
        </div>
      );
    })}
  </div>
);

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  GeoZoneFormValue,
  GeoZonesFormField,
  OptionValueChoice,
} from "@/lib/validations/form";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

const geoZoneTypes: Array<{
  value: GeoZoneFormValue["type"];
  label: string;
}> = [
  { value: "country", label: "Country" },
  { value: "province", label: "Province / state" },
  { value: "city", label: "City" },
  { value: "zip", label: "Postal code" },
];

const parseGeoZones = (raw: string): GeoZoneFormValue[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is GeoZoneFormValue =>
        Boolean(value) &&
        typeof value === "object" &&
        ["country", "province", "city", "zip"].includes(
          (value as { type?: unknown }).type as string,
        ) &&
        typeof (value as { countryCode?: unknown }).countryCode === "string",
    );
  } catch {
    return [];
  }
};

const fieldId = (fieldId: string, index: number, field: string) =>
  `${fieldId}-area-${index}-${field}`;

const CountrySelect = ({
  id,
  countryCode,
  countries,
  onChange,
}: {
  id: string;
  countryCode: string;
  countries: OptionValueChoice[];
  onChange: (countryCode: string) => void;
}) => (
  <div className="space-y-2">
    <Label htmlFor={id} className="text-xs font-medium">
      Country
    </Label>
    <Select value={countryCode || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} variant="card">
        <SelectValue placeholder="Select a country" />
      </SelectTrigger>
      <SelectContent>
        {countries.map((country) => (
          <SelectItem key={country.id} value={country.id}>
            {country.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export const GeoZonesField = ({
  field,
  fieldId: id,
  value,
  onChange,
}: {
  field: GeoZonesFormField;
  fieldId: string;
  value: string;
  onChange?: (value: string) => void;
}) => {
  const [zones, setZones] = useState(() => parseGeoZones(value));
  const zonesValue = JSON.stringify(zones);

  useEffect(() => {
    setZones(parseGeoZones(value));
  }, [value]);

  const commit = (next: GeoZoneFormValue[]) => {
    setZones(next);
    onChange?.(JSON.stringify(next));
  };

  const update = (
    index: number,
    transform: (current: GeoZoneFormValue) => GeoZoneFormValue,
  ) =>
    commit(
      zones.map((zone, zoneIndex) =>
        zoneIndex === index ? transform(zone) : zone,
      ),
    );

  const countries = new Map(field.countries.map((country) => [country.id, country]));

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

      <input type="hidden" name={field.name} value={zonesValue} />

      {zones.length ? (
        <div className="space-y-3">
          {zones.map((zone, index) => {
            const selectedType = geoZoneTypes.find(
              (type) => type.value === zone.type,
            );
            const selectedCountry = countries.get(zone.countryCode);

            return (
              <section
                key={`${index}-${zone.type}`}
                className="space-y-4 rounded-lg border bg-card p-4"
                aria-label={`Geographic area ${index + 1}`}
              >
                <div className="flex items-end gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label
                      htmlFor={fieldId(id, index, "type")}
                      className="text-xs font-medium"
                    >
                      Area type
                    </Label>
                    <Select
                      value={selectedType?.value}
                      onValueChange={(type: GeoZoneFormValue["type"]) =>
                        update(index, (current) => ({
                          type,
                          countryCode: current.countryCode,
                        }))
                      }
                    >
                      <SelectTrigger
                        id={fieldId(id, index, "type")}
                        variant="card"
                      >
                        <SelectValue placeholder="Choose an area type" />
                      </SelectTrigger>
                      <SelectContent>
                        {geoZoneTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Remove geographic area ${index + 1}`}
                    onClick={() => commit(zones.filter((_, i) => i !== index))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                <CountrySelect
                  id={fieldId(id, index, "country")}
                  countryCode={zone.countryCode}
                  countries={field.countries}
                  onChange={(countryCode) =>
                    update(index, (current) => ({ ...current, countryCode }))
                  }
                />

                {zone.type !== "country" ? (
                  <div className="space-y-2">
                    <Label
                      htmlFor={fieldId(id, index, "province")}
                      className="text-xs font-medium"
                    >
                      Province / state code
                    </Label>
                    <Input
                      id={fieldId(id, index, "province")}
                      variant="card"
                      value={zone.provinceCode ?? ""}
                      onChange={(event) =>
                        update(index, (current) => ({
                          ...current,
                          provinceCode: event.target.value,
                        }))
                      }
                      placeholder="Enter the code used by checkout addresses"
                      required
                    />
                  </div>
                ) : null}

                {zone.type === "city" || zone.type === "zip" ? (
                  <div className="space-y-2">
                    <Label
                      htmlFor={fieldId(id, index, "city")}
                      className="text-xs font-medium"
                    >
                      City
                    </Label>
                    <Input
                      id={fieldId(id, index, "city")}
                      variant="card"
                      value={zone.city ?? ""}
                      onChange={(event) =>
                        update(index, (current) => ({
                          ...current,
                          city: event.target.value,
                        }))
                      }
                      placeholder="Enter the city name"
                      required
                    />
                  </div>
                ) : null}

                {zone.type === "zip" ? (
                  <div className="space-y-2">
                    <Label
                      htmlFor={fieldId(id, index, "postal")}
                      className="text-xs font-medium"
                    >
                      Postal code pattern
                    </Label>
                    <Textarea
                      id={fieldId(id, index, "postal")}
                      variant="card"
                      rows={3}
                      className="min-h-20"
                      value={zone.postalExpression ?? ""}
                      onChange={(event) =>
                        update(index, (current) => ({
                          ...current,
                          postalExpression: event.target.value,
                        }))
                      }
                      placeholder="For example, 100* or 10000..10999"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Use * to match remaining characters, .. for an inclusive
                      range, or one pattern per line.
                    </p>
                  </div>
                ) : null}

                {selectedCountry ? (
                  <p className="text-xs text-muted-foreground">
                    Applies within {selectedCountry.value}.
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No geographic areas added.
        </p>
      )}

      {field.error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {field.error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={zones.length >= (field.maxZones ?? 250)}
        onClick={() =>
          commit([...zones, { type: "country", countryCode: "" }])
        }
      >
        <Plus className="mr-2 size-4" />
        Add geographic area
      </Button>
    </fieldset>
  );
};

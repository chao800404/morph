import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeoZonesField } from "./geo-zones-field";

describe("GeoZonesField", () => {
  it("edits postal clauses and serializes added geographic areas", () => {
    const value = JSON.stringify([
      {
        type: "zip",
        countryCode: "tw",
        provinceCode: "TPE",
        city: "Taipei",
        postalExpression: "100*",
      },
    ]);
    const onChange = vi.fn();

    render(
      <GeoZonesField
        field={{
          type: "geo-zones",
          name: "geoZones",
          label: "Geographic areas",
          countries: [{ id: "tw", value: "Taiwan" }],
        }}
        fieldId="field-geoZones"
        value={value}
        onChange={onChange}
      />,
    );

    expect(
      (screen.getByLabelText("Province / state code") as HTMLInputElement).value,
    ).toBe("TPE");
    const postalInput = screen.getByLabelText("Postal code pattern");
    fireEvent.change(postalInput, { target: { value: "100*\n10300..10399" } });

    const submitted = JSON.parse(
      (document.querySelector('input[name="geoZones"]') as HTMLInputElement).value,
    ) as Array<{ postalExpression: string }>;
    expect(submitted[0]?.postalExpression).toBe("100*\n10300..10399");

    fireEvent.click(screen.getByRole("button", { name: "Add geographic area" }));
    const afterAdd = JSON.parse(
      (document.querySelector('input[name="geoZones"]') as HTMLInputElement).value,
    ) as unknown[];
    expect(afterAdd).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith(JSON.stringify(afterAdd));

    fireEvent.click(
      screen.getByRole("button", { name: "Remove geographic area 1" }),
    );
    const afterRemove = JSON.parse(
      (document.querySelector('input[name="geoZones"]') as HTMLInputElement).value,
    ) as unknown[];
    expect(afterRemove).toHaveLength(1);
  });
});

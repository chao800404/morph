import { describe, expect, it } from "vitest";
import { parseProductImportCsv, PRODUCT_IMPORT_TEMPLATE } from "./product-import.csv";

const csv = (rows: string[][]) =>
  rows
    .map((row) =>
      row
        .map((value) =>
          /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value,
        )
        .join(","),
    )
    .join("\n");

const baseHeader =
  "Product Id,Product Handle,Product Title,Product Status,Variant Id,Variant Title,Variant Sku,Variant Option 1 Name,Variant Option 1 Value,Variant Price USD,Variant Price TWD";

describe("parseProductImportCsv", () => {
  it("parses its downloadable template without errors", () => {
    const plan = parseProductImportCsv(PRODUCT_IMPORT_TEMPLATE);
    expect(plan.issues).toEqual([]);
    expect(plan.createCount).toBe(1);
    expect(plan.variantCount).toBe(2);
  });

  it("groups rows by product and parses a multi-variant product", () => {
    const plan = parseProductImportCsv(
      `${baseHeader}\n,,Everyday Mug,draft,,Blue,MUG-BLUE,Color,Blue,12.99,350\n,,Everyday Mug,draft,,Red,MUG-RED,Color,Red,12.99,350`,
    );

    expect(plan.issues).toEqual([]);
    expect(plan.createCount).toBe(1);
    expect(plan.updateCount).toBe(0);
    expect(plan.variantCount).toBe(2);
    expect(plan.groups[0]?.rows.map((row) => row.variant.prices)).toEqual([
      [
        { currencyCode: "usd", amount: 1299 },
        { currencyCode: "twd", amount: 35000 },
      ],
      [
        { currencyCode: "usd", amount: 1299 },
        { currencyCode: "twd", amount: 35000 },
      ],
    ]);
  });

  it("reads quoted commas, embedded newlines, and escaped quotes", () => {
    const plan = parseProductImportCsv(
      `Product Title,Product Description\nMug,"A \"\"large, durable\"\" mug\nMade in Taiwan"`,
    );

    expect(plan.issues).toEqual([]);
    expect(plan.groups[0]?.rows[0]?.product.description).toBe(
      'A "large, durable" mug\nMade in Taiwan',
    );
  });

  it("accepts Morph product export rows with JSON options, prices, tags, and channels", () => {
    const id = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
    const plan = parseProductImportCsv(
      csv([
        [
          "product_id", "product_title", "product_handle", "product_type", "discountable", "tags", "sales_channels", "variant_id", "variant_title", "variant_sku", "manage_inventory", "allow_backorder", "inventory_quantity", "option_values", "variant_prices",
        ],
        [
          id, "Mug", "mug", "Drinkware", "true", JSON.stringify(["ceramic", "gift"]), JSON.stringify([{ id, name: "Online" }]), id, "Default", "MUG-1", "true", "false", "2", JSON.stringify([{ option: "Size", value: "12 oz" }]), JSON.stringify([{ currencyCode: "twd", amount: 35000 }]),
        ],
      ]),
    );

    expect(plan.issues).toEqual([]);
    expect(plan.updateCount).toBe(1);
    expect(plan.groups[0]?.rows[0]?.product.tagValues).toEqual([
      "ceramic",
      "gift",
    ]);
    expect(plan.groups[0]?.rows[0]?.product.salesChannelIds).toEqual([id]);
    expect(plan.groups[0]?.rows[0]?.variant.optionValues).toEqual([
      { name: "Size", value: "12 oz" },
    ]);
    expect(plan.groups[0]?.rows[0]?.variant.prices).toEqual([
      { currencyCode: "twd", amount: 35000 },
    ]);
  });

  it("keeps category names for exact server-side resolution", () => {
    const plan = parseProductImportCsv(
      "Product Title,Product Category 1\nMug,Kitchen",
    );
    expect(plan.issues).toEqual([]);
    expect(plan.groups[0]?.rows[0]?.product.categoryNames).toEqual(["Kitchen"]);
  });

  it("rejects unsupported remote image URLs and malformed rows", () => {
    const plan = parseProductImportCsv(
      "Product Title,Product Image 1\nMug,https://attacker.example/image.jpg\nCup,ok,extra",
    );

    expect(plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, field: "Product Image" }),
        expect.objectContaining({ row: 3, message: "This row has more values than the header" }),
      ]),
    );
  });

  it("rejects incomplete option pairs, invalid identifiers, and malformed CSV quoting", () => {
    const incomplete = parseProductImportCsv(
      "Product Title,Variant Option 1 Name,Variant Option 1 Value,Variant Option 2 Name\nMug,Size,12 oz,Color",
    );
    expect(incomplete.issues.map((issue) => issue.message)).toContain(
      "Every option name needs a matching value",
    );

    const invalidId = parseProductImportCsv(
      `${baseHeader}\nnot-a-uuid,,,,,,,,,,`,
    );
    expect(invalidId.issues.some((issue) => issue.field === "Product Id")).toBe(
      true,
    );

    const malformed = parseProductImportCsv('Product Title\n"Mug');
    expect(malformed.issues[0]?.message).toBe(
      "CSV has an unclosed quoted field",
    );
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SelectedAsset } from "@/components/asset/asset-tile";
import {
  AssetSelectField,
  parseSelectedAssets,
  serializeSelectedAssets,
} from "./asset-select-field";

vi.mock("@/server/asset/create-items.serverFn", () => ({
  createItems: vi.fn(),
}));
vi.mock("./asset-library-panel", () => ({ AssetLibraryPanel: () => null }));
vi.mock("@queries/asset.queries", () => ({
  assetQueries: { all: () => ["assets"] },
}));
// The field reads the store's ceiling straight from config.
vi.mock("@/server/get-config", () => ({
  getConfig: () => ({ client: { upload: { maxAssetsPerRecord: 50 } } }),
}));

const MAX_ASSET_SELECTION = 50;
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const FIELD = { type: "asset-select", name: "assets", label: "Media" } as const;

const ASSETS = [
  { id: "a1", name: "front", url: "/assets/a1.png" },
  { id: "a2", name: "back", url: "/assets/a2.png" },
];

describe("AssetSelectField value transport", () => {
  it("survives a round trip through the JSON value", () => {
    expect(parseSelectedAssets(serializeSelectedAssets(ASSETS))).toEqual(
      ASSETS,
    );
  });

  it("treats an unreadable value as empty rather than throwing", () => {
    // The value is a string on a shared field contract, so nothing stops a
    // caller from putting the wrong shape there. A form must not crash on it.
    expect(parseSelectedAssets("not json")).toEqual([]);
    expect(parseSelectedAssets('{"id":"a1"}')).toEqual([]);
    expect(parseSelectedAssets("")).toEqual([]);
  });

  it("emits the remaining assets when one is removed", () => {
    const onChange = vi.fn();

    render(
      <AssetSelectField
        field={FIELD}
        fieldId="field-assets"
        value={serializeSelectedAssets(ASSETS)}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove front" }));

    expect(parseSelectedAssets(onChange.mock.calls[0][0])).toEqual([ASSETS[1]]);
  });
});

describe("AssetSelectField inside a plain form", () => {
  const hiddenValue = (container: HTMLElement) =>
    (container.querySelector('input[name="assets"]') as HTMLInputElement).value;

  it("updates what it submits with no onChange wired", () => {
    // `RouteFormPage` renders fields declaratively and submits natively — it
    // passes no `onChange`. A field that only reported upwards would let an
    // edit page save exactly what it loaded, however much the author changed.
    const { container } = render(
      <AssetSelectField
        field={FIELD}
        fieldId="field-assets"
        value={serializeSelectedAssets(ASSETS)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove front" }));

    expect(parseSelectedAssets(hiddenValue(container))).toEqual([ASSETS[1]]);
  });
});

describe("AssetSelectField selection limit", () => {
  const many = (count: number): SelectedAsset[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `a${index}`,
      name: `image ${index}`,
      url: `/a${index}.png`,
    }));

  it("keeps a gallery larger than the limit intact", () => {
    // Opening and saving a record must not silently drop images the server
    // already accepted. Removing one should remove exactly one.
    const over = many(MAX_ASSET_SELECTION + 3);
    const { container } = render(
      <AssetSelectField
        field={{ ...FIELD, maxSelected: MAX_ASSET_SELECTION }}
        fieldId="field-assets"
        value={serializeSelectedAssets(over)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove image 0" }));

    const submitted = parseSelectedAssets(
      (container.querySelector('input[name="assets"]') as HTMLInputElement)
        .value,
    );

    expect(submitted).toHaveLength(over.length - 1);
    expect(submitted[0].id).toBe("a1");
  });
});

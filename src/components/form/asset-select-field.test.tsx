import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

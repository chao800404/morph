import { describe, expect, it } from "vitest";
import { createAssetsDialogConfig } from "./asset-create.config";

const uploadConfig = {
  maxFileSize: 5_000_000,
  minFiles: 1,
  maxFiles: 10,
  allowedTypes: ["image/png"],
  allowedExtensions: [],
};

describe("asset create config", () => {
  it("reuses the product asset picker when creating a folder", () => {
    const field = createAssetsDialogConfig(uploadConfig).folder.fields.find(
      (candidate) => candidate.name === "selected-assets",
    );

    expect(field).toMatchObject({
      type: "asset-select",
      label: "Assets",
      colSpan: 2,
      maxSelected: 10,
    });
  });

  it("keeps direct asset creation on the shared upload field", () => {
    const field = createAssetsDialogConfig(uploadConfig).upload.fields.find(
      (candidate) => candidate.name === "assets",
    );

    expect(field).toMatchObject({
      type: "upload",
      maxFiles: 10,
      maxSize: 5_000_000,
    });
  });
});

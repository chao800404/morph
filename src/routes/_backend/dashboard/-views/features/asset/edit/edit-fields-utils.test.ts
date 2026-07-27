import { describe, expect, it } from "vitest";
import { generateEditFields } from "./edit-fields-utils";

const folderId = "22222222-2222-4222-8222-222222222222";

describe("generateEditFields location", () => {
  it("shows the active asset's actual folder", () => {
    const fields = generateEditFields({
      id: "11111111-1111-4111-8111-111111111111",
      type: "asset",
      name: "Asset",
      fileType: "image",
      locationId: folderId,
    });

    expect(fields.find((field) => field.name === "Folder")).toMatchObject({
      type: "folder-select",
      value: folderId,
    });
  });

  it("uses Root and excludes the active folder from its destination tree", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const fields = generateEditFields({
      id,
      type: "folder",
      name: "Folder",
      locationId: null,
    });

    expect(fields.find((field) => field.name === "Folder")).toMatchObject({
      type: "folder-select",
      value: "root",
      excludedIds: [id],
    });
  });
});

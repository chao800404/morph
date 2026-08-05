import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadStore } from "./_store/upload.store";
import { UploadField } from "./upload";

const FIELD = { type: "upload", name: "assets", label: "Assets" } as const;

const seedOneFile = () => {
  useUploadStore.getState().setFileData(FIELD.name, [
    {
      file: new File(["x"], "camera.png", { type: "image/png" }),
      preview: "blob:preview-1",
    },
  ]);
};

describe("UploadField", () => {
  beforeEach(() => {
    // jsdom has no object-URL implementation, and the store revokes on clear.
    URL.revokeObjectURL = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:preview-1");
    useUploadStore.getState().clearAll();
  });

  it("drops its files when the surface closes", () => {
    // The store is global: a create page closed without submitting used to
    // leave its files there, so reopening it showed the previous upload.
    const { unmount } = render(
      <UploadField field={FIELD} fieldId="field-assets" />,
    );
    seedOneFile();

    expect(useUploadStore.getState().fileData[FIELD.name]).toHaveLength(1);

    unmount();

    expect(useUploadStore.getState().fileData[FIELD.name]).toBeUndefined();
  });

  it("revokes the previews it drops", () => {
    // Otherwise every abandoned upload leaks until the tab is closed.
    const { unmount } = render(
      <UploadField field={FIELD} fieldId="field-assets" />,
    );
    seedOneFile();

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });
});

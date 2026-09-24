// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  classifyPreviewAddressProbe,
  previewAddressBelongsTo,
} from "./preview-address-probe";

const OWN = {
  previewId: "5f919496efe1c5c71e5c59c2aea22425",
  previewHostname: "preview.localhost",
  port: 5173,
};

describe("previewAddressBelongsTo", () => {
  it("accepts this author's own preview address", () => {
    expect(
      previewAddressBelongsTo({
        ...OWN,
        previewOrigin:
          "http://5173-5f919496efe1c5c71e5c59c2aea22425-oyoqfh6fzfykvtz2.preview.localhost:3000",
      })?.hostname,
    ).toBe(
      "5173-5f919496efe1c5c71e5c59c2aea22425-oyoqfh6fzfykvtz2.preview.localhost",
    );
  });

  it("refuses anything that is not this author's preview", () => {
    for (const previewOrigin of [
      // Another author's sandbox.
      "http://5173-0000000000000000000000000000abcd-tok.preview.localhost:3000",
      // Another port in the right sandbox.
      "http://3000-5f919496efe1c5c71e5c59c2aea22425-tok.preview.localhost:3000",
      // The right label under a host that is not the preview host.
      "https://5173-5f919496efe1c5c71e5c59c2aea22425-tok.evil.example",
      "https://5173-5f919496efe1c5c71e5c59c2aea22425-tok.preview.localhost.evil.example",
      "http://localhost:3000",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(previewAddressBelongsTo({ ...OWN, previewOrigin })).toBeNull();
    }
  });
});

describe("classifyPreviewAddressProbe", () => {
  it("treats only the SDK's two refusals as a stale address", () => {
    expect(classifyPreviewAddressProbe(200, null)).toBe("serving");
    expect(classifyPreviewAddressProbe(304, null)).toBe("serving");
    expect(classifyPreviewAddressProbe(410, "STALE_PREVIEW_URL")).toBe("stale");
    expect(classifyPreviewAddressProbe(404, "INVALID_TOKEN")).toBe("stale");
  });

  it("never takes other failures for a restarted container", () => {
    expect(classifyPreviewAddressProbe(410, null)).toBe("unknown");
    expect(classifyPreviewAddressProbe(404, null)).toBe("unknown");
    expect(classifyPreviewAddressProbe(500, null)).toBe("unknown");
    expect(classifyPreviewAddressProbe(502, "INVALID_TOKEN")).toBe("unknown");
  });
});

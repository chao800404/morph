import { describe, expect, it } from "vitest";
import {
  isRequestedInlineFinishCommit,
  type InlineFinishRequest,
} from "./inline-finish-request";

const request: InlineFinishRequest = {
  id: 3,
  previewKey: "https://preview.test/p-1",
  sectionId: "hero",
  fieldKey: "heading",
  fieldPath: "heading",
};

const answer = {
  sectionId: "hero",
  fieldKey: "heading",
  fieldPath: "heading",
  finishRequestId: 3,
};

describe("isRequestedInlineFinishCommit", () => {
  it("is the commit that answers the open request, in the same document and field", () => {
    expect(isRequestedInlineFinishCommit(request, answer, request.previewKey)).toBe(
      true,
    );
  });

  it("is not a commit from another preview document", () => {
    expect(
      isRequestedInlineFinishCommit(request, answer, "https://preview.test/p-2"),
    ).toBe(false);
  });

  it("is not a commit to another field, or another section", () => {
    expect(
      isRequestedInlineFinishCommit(
        request,
        { ...answer, fieldKey: "subheading", fieldPath: "subheading" },
        request.previewKey,
      ),
    ).toBe(false);
    expect(
      isRequestedInlineFinishCommit(
        request,
        { ...answer, sectionId: "banner" },
        request.previewKey,
      ),
    ).toBe(false);
  });

  it("is not a commit naming another request, or none", () => {
    expect(
      isRequestedInlineFinishCommit(
        request,
        { ...answer, finishRequestId: 2 },
        request.previewKey,
      ),
    ).toBe(false);
    const { finishRequestId: _omitted, ...unnamed } = answer;
    expect(
      isRequestedInlineFinishCommit(request, unnamed, request.previewKey),
    ).toBe(false);
  });

  it("is nothing once the request is answered or over: repeats and late arrivals are input", () => {
    // The caller clears the request on the first match and when finishing
    // ends; the same commit again then meets no request.
    expect(isRequestedInlineFinishCommit(null, answer, request.previewKey)).toBe(
      false,
    );
  });
});

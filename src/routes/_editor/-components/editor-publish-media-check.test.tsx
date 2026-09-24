import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/storefront/storefront-publish-check.serverFn", () => ({
  checkStorefrontPublishMedia: vi.fn(),
}));

import {
  EditorPublishMediaCheck,
  publishConfirmation,
  publishMediaCheckState,
} from "./editor-publish-media-check";

describe("publishMediaCheckState", () => {
  it("reads the query as checking, failed or done", () => {
    expect(publishMediaCheckState({ isPending: true, isError: false })).toEqual(
      { status: "checking" },
    );
    expect(publishMediaCheckState({ isPending: false, isError: true })).toEqual(
      { status: "failed" },
    );
    expect(
      publishMediaCheckState({
        isPending: false,
        isError: false,
        data: { success: false, data: null },
      }),
    ).toEqual({ status: "failed" });
    expect(
      publishMediaCheckState({
        isPending: false,
        isError: false,
        data: {
          success: true,
          data: { brokenImages: ["Home › hero › imageSrc"] },
        },
      }),
    ).toEqual({ status: "done", brokenImages: ["Home › hero › imageSrc"] });
  });
});

describe("publishConfirmation", () => {
  it("waits for the check, and asks to publish anyway when images are broken", () => {
    expect(publishConfirmation({ status: "checking" })).toEqual({
      disabled: true,
      label: "Publish",
    });
    expect(
      publishConfirmation({
        status: "done",
        brokenImages: ["Home › hero › imageSrc"],
      }),
    ).toEqual({ disabled: false, label: "Publish anyway" });
    expect(publishConfirmation({ status: "done", brokenImages: [] })).toEqual({
      disabled: false,
      label: "Publish",
    });
    // A check that could not run does not hold the release hostage.
    expect(publishConfirmation({ status: "failed" })).toEqual({
      disabled: false,
      label: "Publish",
    });
  });
});

describe("EditorPublishMediaCheck", () => {
  it("lists each place before the release goes live", () => {
    render(
      <EditorPublishMediaCheck
        state={{
          status: "done",
          brokenImages: [
            "Home › hero › imageSrc",
            "/pages/about › intro › imageSrc",
          ],
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("2 images will not show to visitors");
    expect(screen.getByText("Home › hero › imageSrc")).toBeTruthy();
    expect(screen.getByText("/pages/about › intro › imageSrc")).toBeTruthy();
  });

  it("counts what it does not list", () => {
    render(
      <EditorPublishMediaCheck
        state={{
          status: "done",
          brokenImages: Array.from(
            { length: 8 },
            (_, i) => `Home › s${i} › imageSrc`,
          ),
        }}
      />,
    );
    expect(screen.getByText("and 2 more")).toBeTruthy();
  });

  it("says nothing when every image will show", () => {
    const { container } = render(
      <EditorPublishMediaCheck state={{ status: "done", brokenImages: [] }} />,
    );
    expect(container.textContent).toBe("");
  });

  it("says when the check could not run", () => {
    render(<EditorPublishMediaCheck state={{ status: "failed" }} />);
    expect(screen.getByText(/Could not check/)).toBeTruthy();
  });
});

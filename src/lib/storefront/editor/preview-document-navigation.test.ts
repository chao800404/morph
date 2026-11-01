import { describe, expect, it } from "vitest";
import {
  initialPreviewDocumentNavigationState as idle,
  previewDocumentNavigationNotice,
  reducePreviewDocumentNavigation as reduce,
  type PreviewDocumentNavigationEvent,
  type PreviewDocumentNavigationState,
} from "./preview-document-navigation";

const run = (
  events: PreviewDocumentNavigationEvent[],
  from: PreviewDocumentNavigationState = idle,
) => events.reduce(reduce, from);

const sent = (routePath: string, at = 0, key = "frame-1") =>
  ({ type: "route-sent", key, routePath, at }) as const;
const answered = (routePath: string | null, key = "frame-1") =>
  ({ type: "route-answered", key, routePath }) as const;

describe("a page switch in a preview that navigates as documents", () => {
  it("is opening until the frame answers with the page asked for, then open", () => {
    const opening = run([sent("/about", 5)]);
    expect(opening).toMatchObject({
      status: "opening",
      routePath: "/about",
      startedAt: 5,
    });
    expect(previewDocumentNavigationNotice(opening, "frame-1")).toMatchObject({
      kind: "status",
    });

    // An answer naming another page is no answer.
    expect(run([answered("/")], opening)).toBe(opening);
    const open = run([answered("/about/")], opening);
    expect(open).toEqual({
      status: "open",
      key: "frame-1",
      routePath: "/about",
    });
    expect(previewDocumentNavigationNotice(open, "frame-1")).toBeNull();
  });

  it("keeps one clock across the documents a switch passes through", () => {
    const opening = run([sent("/about", 5), sent("/about", 900)]);
    expect(opening).toMatchObject({ status: "opening", startedAt: 5 });
  });

  it("times out into a clear failure, never into open", () => {
    const opening = run([sent("/about", 5)]);
    const failed = run(
      [
        {
          type: "timed-out",
          key: "frame-1",
          routePath: "/about",
          startedAt: 5,
        },
      ],
      opening,
    );
    expect(failed).toMatchObject({ status: "failed", reason: "timeout" });
    expect(previewDocumentNavigationNotice(failed, "frame-1")).toMatchObject({
      kind: "alert",
      message: expect.stringContaining("did not open /about"),
      retry: true,
    });
    // A late answer is still the page being there.
    expect(run([answered("/about")], failed)).toMatchObject({ status: "open" });
  });

  it("ignores a timer from a switch that has been replaced", () => {
    const opening = run([sent("/about", 5), sent("/contact", 7)]);
    expect(
      run(
        [
          {
            type: "timed-out",
            key: "frame-1",
            routePath: "/about",
            startedAt: 5,
          },
        ],
        opening,
      ),
    ).toBe(opening);
  });

  it("fails at once for a dynamic route pattern, which has no address", () => {
    const failed = run([sent("/blog/[slug]")]);
    expect(failed).toMatchObject({ status: "failed", reason: "pattern" });
    // Reloading the preview cannot give a pattern an address.
    expect(previewDocumentNavigationNotice(failed, "frame-1")).toMatchObject({
      kind: "alert",
      retry: false,
    });
    expect(run([answered("/blog/[slug]")], failed)).toBe(failed);
  });

  it("says the switch did not happen when the frame answers it has no page to go to", () => {
    expect(run([sent("/about"), answered(null)])).toMatchObject({
      status: "failed",
      reason: "not-navigated",
    });
  });

  it("says nothing while the same page's document comes back", () => {
    const reloading = run([
      sent("/about"),
      answered("/about"),
      sent("/about", 50),
    ]);
    expect(reloading).toMatchObject({ status: "opening", from: "/about" });
    expect(previewDocumentNavigationNotice(reloading, "frame-1")).toBeNull();
  });

  it("belongs to one frame: another frame's answer or a replaced frame is not it", () => {
    const opening = run([sent("/about")]);
    expect(run([answered("/about", "frame-2")], opening)).toBe(opening);
    expect(previewDocumentNavigationNotice(opening, "frame-2")).toBeNull();
    expect(run([sent("/about", 1, "frame-2")], opening)).toMatchObject({
      key: "frame-2",
      from: null,
    });
  });
});

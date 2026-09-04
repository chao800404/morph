import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ThemePreviewPlaceholderDesktop,
  ThemePreviewPlaceholderMobile,
} from "./theme-preview-placeholder";

const renderings = [
  ["desktop", renderToStaticMarkup(<ThemePreviewPlaceholderDesktop />)],
  ["mobile", renderToStaticMarkup(<ThemePreviewPlaceholderMobile />)],
] as const;

describe("theme preview placeholder", () => {
  it.each(renderings)("draws %s without loading any image", (_name, html) => {
    // The point of replacing the photograph is that nothing here is a picture
    // of a shop. An <img> or a url() would put one back.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("theme-preview-default");
    expect(html).not.toContain("url(");
  });

  it.each(renderings)("announces %s as an empty state", (_name, html) => {
    expect(html).toContain('role="img"');
    expect(html).toContain("No preview captured yet");
  });

  it.each(renderings)(
    "inherits %s colour from its surroundings",
    (_name, html) => {
      // currentColor is what lets one drawing work in light and dark without a
      // second copy. A literal colour here would look wrong in one of them.
      expect(html).toContain('fill="currentColor"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).not.toMatch(/(fill|stroke)="#[0-9a-f]{3,8}"/i);
    },
  );

  it.each(renderings)("marks where %s images belong", (_name, html) => {
    // The frame-and-mountain glyph is the convention people already read as
    // "an image goes here". The shape invented before it read as a blob.
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21");
  });

  it("keeps each viewport in its own aspect ratio", () => {
    // The card renders these into 16/7 and 4/5 slots. One shared viewBox would
    // stretch in at least one of them.
    expect(renderings[0][1]).toContain('viewBox="0 0 800 350"');
    expect(renderings[1][1]).toContain('viewBox="0 0 320 400"');
  });
});

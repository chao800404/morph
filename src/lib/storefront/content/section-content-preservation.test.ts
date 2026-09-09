/**
 * A content edit must never delete content it did not touch.
 *
 * The stored props were validated when they were written; re-validating them
 * on every later edit turns any drift in the manifest into silent deletion.
 * The case that reached a real store: a section whose `componentRef` named a
 * component the manifest no longer declares. Editing one word of its header
 * emptied the whole section — navigation, cart link and all — and the editor
 * then showed the fields it had just erased as simply empty.
 */
import { describe, expect, it } from "vitest";
import { filterSectionContentProps } from "./section-content-manifest";
import { resolveThemeContentCapabilitiesFromFiles } from "../theme-content-capability-resolver";
import { STARTER_THEME_FILES } from "../starter-theme-files";

const { capabilities } = resolveThemeContentCapabilitiesFromFiles(
  STARTER_THEME_FILES.map((file) => ({
    path: file.path,
    content: file.content,
  })) as never,
);

const headerProps = {
  storeName: "Kinfolk",
  navItems: [{ label: "Shop", link: { href: "/collections/all" } }],
  cartLabel: "Cart (0)",
};

describe("what a componentRef decides", () => {
  it("keeps declared fields for a ref the Theme knows", () => {
    expect(
      filterSectionContentProps(
        "header",
        headerProps,
        "header.default",
        capabilities,
      ),
    ).toEqual(headerProps);
  });

  it("still refuses an unknown ref for incoming values", () => {
    // Fail-closed is right for what a client sent: an unrecognised component
    // is not a licence to store arbitrary props.
    expect(
      filterSectionContentProps(
        "header",
        headerProps,
        "layout.header",
        capabilities,
      ),
    ).toEqual({});
  });

  it("resolves the seeded shell refs, which is what stops the erasure", () => {
    // The seeded layout document once named `layout.*`, which the manifest
    // declares as a source but not as a content capability. Every shell edit
    // was filtered against nothing.
    expect(capabilities["header.default"]).toBeTruthy();
    expect(capabilities["footer.default"]).toBeTruthy();
    expect(capabilities["layout.header"]).toBeUndefined();
  });
});

// @vitest-environment node
/**
 * What happens after an author deletes a component the Theme still imports.
 *
 * Deleting is a real edit and stays allowed — a Theme workspace is code, and
 * refusing the delete would make it less than a code editor. What must not
 * follow is a blank store: one deleted file used to abort the entire render,
 * so every page of the editor became a single error message, including the
 * panel the author would have used to put the file back.
 *
 * The failure is therefore contained to the slot that failed. Publishing is a
 * different question and stays fail-closed: the real build still cannot
 * resolve the missing import.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import { createDefaultStorefrontHomeDocument } from "./default-storefront-document";
import { STARTER_THEME_FILES } from "./starter-theme-files";

const allFiles = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
}));

function renderHomeWithout(deleted: string) {
  const result = renderSafeThemeRoute({
    files: allFiles.filter((file) => file.path !== deleted),
    pathname: "/",
    document: createDefaultStorefrontHomeDocument(),
  } as never);
  expect(
    result.success,
    result.success ? "" : result.diagnostics.join("; "),
  ).toBe(true);
  return renderToStaticMarkup(result.node as never);
}

describe("a deleted component", () => {
  it("does not take the rest of the page with it", () => {
    const markup = renderHomeWithout("src/components/Hero.tsx");

    // The shell and every other section still render.
    expect(markup).toContain("<header");
    expect(markup).toContain("<footer");
    expect(markup).toContain("Considered living");
    // Only the deleted one is gone.
    expect(markup).not.toContain("everyday rituals");
  });

  it("leaves a marked gap where the component was", () => {
    const markup = renderHomeWithout("src/components/Footer.tsx");

    expect(markup).toContain(
      'data-morph-missing-component="src/components/Footer.tsx"',
    );
    expect(markup).toContain('data-morph-section="starter-footer"');
    // The gap says what is missing and how to undo it, because the author who
    // deleted the file is the one who has to read it.
    expect(markup).toContain("was deleted");
    expect(markup).toContain("history");
    // And it is the way back, not just a label.
    expect(markup).toContain("cursor:pointer");
  });

  it("contains a module shared by every component", () => {
    // The link component is imported by five of them: a mistake here used to
    // be indistinguishable from the store being gone.
    const markup = renderHomeWithout("src/morph/link.tsx");

    expect(markup).toContain("<header");
    expect(markup).toContain("Considered living");
  });

  it.each([
    "src/components/Header.tsx",
    "src/components/Footer.tsx",
    "src/components/Hero.tsx",
    "src/morph/link.tsx",
  ])("keeps %s recoverable rather than fatal", (path) => {
    expect(() => renderHomeWithout(path)).not.toThrow();
  });
});

describe("a component the Theme never had", () => {
  it("is still refused", () => {
    // Containment is for a file that was deleted, not for an import the
    // sandbox was never going to honour.
    const result = renderSafeThemeComponent({
      files: [
        {
          path: "src/components/Probe.tsx",
          content:
            'import { Chart } from "some-package";\n' +
            "export default function Probe() {\n  return <Chart />;\n}",
        },
      ],
      sourcePath: "src/components/Probe.tsx",
      props: {},
    } as never);

    expect(result.success).toBe(false);
    // The message names the module, so the author knows which import to remove.
    expect(result.diagnostics.join(" ")).toContain("Chart");
    expect(result.diagnostics.join(" ")).toContain("some-package");
  });
});

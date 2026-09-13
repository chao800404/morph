// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planNewThemePage } from "./theme-page-scaffold";

const existing = [
  "src/routes/__root.tsx",
  "src/routes/index.tsx",
  "src/routes/lookbook.tsx",
  "src/routes/products.index.tsx",
  "src/routes/products.$slug.tsx",
  "src/components/Hero.tsx",
];

const plan = (requestedPath: string) =>
  planNewThemePage({ requestedPath, existingPaths: existing });

describe("planning a page an author asked for", () => {
  it("puts an ordinary page where its address says it is", () => {
    const result = plan("/about");
    expect(result).toMatchObject({
      ok: true,
      sourcePath: "src/routes/about.tsx",
      routePath: "/about",
      componentName: "AboutRoute",
    });
  });

  it("accepts the address however the author spelled it", () => {
    // Typed into a text field by someone who is describing an address, not
    // writing a path: a missing slash or a trailing one is the same page.
    for (const spelling of ["about", "/about/", " /about ", "//about"]) {
      expect(plan(spelling)).toMatchObject({
        ok: true,
        sourcePath: "src/routes/about.tsx",
      });
    }
  });

  it("nests a deeper address in directories", () => {
    expect(plan("/blog/first-post")).toMatchObject({
      ok: true,
      sourcePath: "src/routes/blog/first-post.tsx",
      componentName: "BlogFirstPostRoute",
    });
  });

  it("names a component a parameter segment cannot", () => {
    // `$` is how a route names a parameter and is not a legal identifier.
    expect(plan("/notes/$slug")).toMatchObject({
      ok: true,
      componentName: "NotesSlugRoute",
    });
  });

  it("gives the page a container a section can be added to", () => {
    const result = plan("/about");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Adding a section inserts before the closing tag, so a self-closing
    // container would be a page nothing could ever be put in.
    expect(result.content).toContain("<main></main>");
    expect(result.content).toContain('createFileRoute("/about")');
    expect(result.content).toContain("function AboutRoute()");
  });
});

describe("refusing a page that cannot be created", () => {
  it("refuses an empty path", () => {
    expect(plan("   ")).toMatchObject({ ok: false });
  });

  it("refuses an address the Theme already serves", () => {
    expect(plan("/lookbook")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("src/routes/lookbook.tsx"),
    });
  });

  it("refuses an address already served under a different spelling", () => {
    // `products.$slug.tsx` and `products/$slug.tsx` are the same address, and
    // creating the second would leave two files claiming one route.
    expect(plan("/products/$slug")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("products.$slug.tsx"),
    });
  });

  it("refuses a path that climbs out of the routes directory", () => {
    expect(plan("/../../etc/passwd")).toMatchObject({ ok: false });
  });

  it("names the page in the reason, not the file", () => {
    // The author typed an address; a refusal about a path they never wrote
    // would be about something they cannot see.
    const result = plan("/../secrets");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("/../secrets");
  });
});

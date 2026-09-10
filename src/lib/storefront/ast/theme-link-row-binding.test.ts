import { describe, expect, it } from "vitest";
import {
  patchThemeLinkElement,
  resolveThemeLinkBinding,
} from "@/lib/storefront/ast/theme-link-binding";

const source = `export default function Header({ items = [], cartLink = {} }) {
  return (
    <header>
      <nav>
        {items.map((item, index) => (
          <a key={index} href={item.link.href} target={item.link.target}>
            {item.label}
          </a>
        ))}
      </nav>
      <a href={cartLink.href}>Cart</a>
    </header>
  );
}`;

describe("a destination inside a repeated field", () => {
  it("is recognised as an anchor", () => {
    expect(resolveThemeLinkBinding(source, "link")).toBe("anchor");
  });

  it("does not confuse a sibling field for it", () => {
    expect(resolveThemeLinkBinding(source, "cartLink")).toBe("anchor");
  });

  it("can be rewritten into a router Link", () => {
    const patched = patchThemeLinkElement(source, "link", "router");
    expect(patched.editable).toBe(true);
    expect(patched.code).toContain("<Link");
    expect(patched.code).toContain("to={item.link.href}");
    expect(patched.code).toContain('from "@tanstack/react-router"');
    // The cart anchor is a different field and must be left alone.
    expect(patched.code).toContain("<a href={cartLink.href}>Cart</a>");
  });
});

describe("a field whose element the source chooses per row", () => {
  const branching = `import { Link } from "@tanstack/react-router";

export default function Header({ items = [] }) {
  return (
    <nav>
      {items.map((item, index) =>
        item.link.href.startsWith("http") ? (
          <a key={index} href={item.link.href}>{item.label}</a>
        ) : (
          <Link key={index} to={item.link.href}>{item.label}</Link>
        ),
      )}
    </nav>
  );
}`;

  it("has no single binding to report", () => {
    // Answering with whichever element came first would state one branch as
    // the answer for all of them, and the panel would then offer a switch that
    // rewrites only half the rows.
    expect(resolveThemeLinkBinding(branching, "link")).toBe("unknown");
  });

  it("refuses to rewrite one branch of it", () => {
    const patched = patchThemeLinkElement(branching, "link", "router");

    expect(patched.editable).toBe(false);
    expect(patched.reason).toBe("ambiguous");
    expect(patched.code).toBe(branching);
  });
});

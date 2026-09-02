import { describe, expect, it } from "vitest";
import {
  patchThemeLinkBinding,
  patchThemeLinkElement,
  resolveThemeLinkBinding,
} from "./theme-link-binding";

describe("resolveThemeLinkBinding", () => {
  it("reads a router destination as router-bound", () => {
    expect(
      resolveThemeLinkBinding(
        `import { Link } from "@tanstack/react-router";

export default function Hero({ action }) {
  return <Link to={action.href}>Go</Link>;
}`,
        "action",
      ),
    ).toBe("router");
  });

  it("reads a plain anchor as anchor-bound", () => {
    expect(
      resolveThemeLinkBinding(
        `export default function Hero({ action }) {
  return <a href={action.href}>Go</a>;
}`,
        "action",
      ),
    ).toBe("anchor");
  });

  it("reads a bare prop on a router Link", () => {
    expect(
      resolveThemeLinkBinding(
        `export default function Hero({ actionHref }) {
  return <Link to={actionHref}>Go</Link>;
}`,
        "actionHref",
      ),
    ).toBe("router");
  });

  it("sees through a fallback", () => {
    expect(
      resolveThemeLinkBinding(
        `export default function Hero({ actionHref }) {
  return <Link to={actionHref ?? "/"}>Go</Link>;
}`,
        "actionHref",
      ),
    ).toBe("router");
  });

  it("does not claim a binding for a literal destination", () => {
    // The prop exists but never reaches the link, so there is nothing to
    // constrain and nothing to edit.
    expect(
      resolveThemeLinkBinding(
        `export default function Hero({ actionHref }) {
  return <Link to="/aboutus">Go</Link>;
}`,
        "actionHref",
      ),
    ).toBe("unknown");
  });

  it("does not claim a binding for a prop used somewhere else", () => {
    expect(
      resolveThemeLinkBinding(
        `export default function Hero({ heading }) {
  return <h1>{heading}</h1>;
}`,
        "heading",
      ),
    ).toBe("unknown");
  });

  it("treats a wrapper component taking href as an anchor", () => {
    expect(
      resolveThemeLinkBinding(
        `export default function Hero({ action }) {
  return <Button href={action.href}>Go</Button>;
}`,
        "action",
      ),
    ).toBe("anchor");
  });

  it("survives source it cannot parse", () => {
    expect(resolveThemeLinkBinding("export default function (", "action")).toBe(
      "unknown",
    );
    expect(resolveThemeLinkBinding(null, "action")).toBe("unknown");
  });
});

describe("patchThemeLinkBinding", () => {
  it("connects one hard-coded Link destination to the requested prop", () => {
    const source = `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <Link to="/aboutus">Go</Link>;
}`;

    const result = patchThemeLinkBinding(source, "actionHref");

    expect(result).toEqual({
      code: `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <Link to={actionHref}>Go</Link>;
}`,
      editable: true,
    });
  });

  it("refuses to guess when a file has multiple hard-coded Links", () => {
    const source = `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <><Link to="/about">About</Link><Link to="/shop">Shop</Link></>;
}`;

    expect(patchThemeLinkBinding(source, "actionHref")).toMatchObject({
      code: source,
      editable: false,
      reason: "ambiguous",
    });
  });

  it("leaves dynamic destinations code-only", () => {
    const source = `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <Link to={getDestination(actionHref)}>Go</Link>;
}`;

    expect(patchThemeLinkBinding(source, "actionHref")).toMatchObject({
      code: source,
      editable: false,
      reason: "not-found",
    });
  });
});

describe("patchThemeLinkElement", () => {
  it("turns a router Link into an anchor so it can leave the store", () => {
    const source = `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <Link to={actionHref} className="btn">Go</Link>;
}`;

    const result = patchThemeLinkElement(source, "actionHref", "anchor");

    expect(result.editable).toBe(true);
    expect(result.code).toContain('<a href={actionHref} className="btn">Go</a>');
  });

  it("turns an anchor into a router Link and adds the import", () => {
    const source = `export default function Hero({ actionHref }) {
  return <a href={actionHref} className="btn">Go</a>;
}`;

    const result = patchThemeLinkElement(source, "actionHref", "router");

    expect(result.editable).toBe(true);
    expect(result.code).toContain(
      'import { Link } from "@tanstack/react-router";',
    );
    expect(result.code).toContain(
      '<Link to={actionHref} className="btn">Go</Link>',
    );
  });

  it("adds Link to an existing router import rather than duplicating it", () => {
    const source = `import { createFileRoute } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <a href={actionHref}>Go</a>;
}`;

    const result = patchThemeLinkElement(source, "actionHref", "router");

    expect(result.code).toContain(
      'import { Link, createFileRoute } from "@tanstack/react-router";',
    );
    expect(result.code.match(/@tanstack\/react-router/g)).toHaveLength(1);
  });

  it("leaves an existing Link import alone", () => {
    const source = `import { Link } from "@tanstack/react-router";

export default function Hero({ actionHref }) {
  return <a href={actionHref}>Go</a>;
}`;

    const result = patchThemeLinkElement(source, "actionHref", "router");

    expect(result.code.match(/import \{ Link \}/g)).toHaveLength(1);
  });

  it("rewrites a self-closing element", () => {
    const source = `export default function Hero({ actionHref }) {
  return <a href={actionHref} />;
}`;

    const result = patchThemeLinkElement(source, "actionHref", "router");

    expect(result.code).toContain("<Link to={actionHref} />");
  });

  it("preserves the destination expression it did not ask about", () => {
    const source = `import { Link } from "@tanstack/react-router";

export default function Hero({ action }) {
  return <Link to={action.href}>Go</Link>;
}`;

    const result = patchThemeLinkElement(source, "action", "anchor");

    expect(result.code).toContain("<a href={action.href}>Go</a>");
  });

  it("is a no-op when the element is already what was asked for", () => {
    const source = `export default function Hero({ actionHref }) {
  return <a href={actionHref}>Go</a>;
}`;

    expect(patchThemeLinkElement(source, "actionHref", "anchor")).toEqual({
      code: source,
      editable: true,
    });
  });

  it("refuses to guess between several links bound to the same field", () => {
    const source = `export default function Hero({ actionHref }) {
  return <><a href={actionHref}>A</a><a href={actionHref}>B</a></>;
}`;

    expect(patchThemeLinkElement(source, "actionHref", "router")).toMatchObject({
      code: source,
      editable: false,
      reason: "ambiguous",
    });
  });

  it("reports when the field reaches no link at all", () => {
    const source = `export default function Hero({ actionHref }) {
  return <Link to="/aboutus">Go</Link>;
}`;

    expect(patchThemeLinkElement(source, "actionHref", "anchor")).toMatchObject({
      editable: false,
      reason: "not-found",
    });
  });
});

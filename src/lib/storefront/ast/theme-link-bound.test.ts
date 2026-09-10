/**
 * A link whose element is chosen elsewhere is still a working link.
 *
 * The panel warns when a destination field reaches nothing, and offers to
 * rewrite the component to connect it. That warning read the same signal as
 * "which element renders this", which cannot tell "nothing renders it" from
 * "a component in between decides" — so a section that handed its destination
 * to a shared link component was told its link was broken, beside an offer to
 * repair what was already correct.
 */
import { describe, expect, it } from "vitest";
import {
  isThemeLinkFieldBound,
  resolveThemeLinkBinding,
} from "./theme-link-binding";

const viaComponent = `import ThemeLink from "../morph/link";
export default function Hero({ actionHref = "/x", actionLabel = "Go" }) {
  return <ThemeLink link={actionHref}>{actionLabel}</ThemeLink>;
}`;

const viaAnchor = `export default function Hero({ actionHref = "/x" }) {
  return <a href={actionHref}>Go</a>;
}`;

const hardcoded = `export default function Hero({ actionLabel = "Go" }) {
  return <a href="/collections/all">{actionLabel}</a>;
}`;

describe("whether a destination field reaches anything", () => {
  it("counts a component that takes it on a prop of its own name", () => {
    expect(isThemeLinkFieldBound(viaComponent, "actionHref")).toBe(true);
    // The element is the component's decision, so there is none to report.
    expect(resolveThemeLinkBinding(viaComponent, "actionHref")).toBe("unknown");
  });

  it("counts a plain anchor", () => {
    expect(isThemeLinkFieldBound(viaAnchor, "actionHref")).toBe(true);
    expect(resolveThemeLinkBinding(viaAnchor, "actionHref")).toBe("anchor");
  });

  it("still reports a destination nothing renders", () => {
    expect(isThemeLinkFieldBound(hardcoded, "actionHref")).toBe(false);
  });

  it("does not count the field appearing only as text", () => {
    const asText = `export default function Hero({ actionHref = "/x" }) {
  return <p>{actionHref}</p>;
}`;
    expect(isThemeLinkFieldBound(asText, "actionHref")).toBe(false);
  });

  it("tolerates a file it cannot parse", () => {
    expect(isThemeLinkFieldBound("export default function ( {", "actionHref")).toBe(
      false,
    );
    expect(isThemeLinkFieldBound(null, "actionHref")).toBe(false);
  });
});

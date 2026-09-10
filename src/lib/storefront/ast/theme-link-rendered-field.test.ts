import { describe, expect, it } from "vitest";
import { resolveLinkFieldKeysForRenderedField } from "./theme-link-binding";

const resolve = (source: string, rendered: string, keys: string[]) =>
  resolveLinkFieldKeysForRenderedField(source, rendered, keys);

describe("the destination of the element a field is rendered in", () => {
  it("finds it through the children", () => {
    const source = `export default function Hero({ actionLabel, action }) {
      return <ThemeLink link={action}>{actionLabel}</ThemeLink>;
    }`;
    expect(resolve(source, "actionLabel", ["action"])).toEqual(["action"]);
  });

  it("does not depend on how the two fields are named", () => {
    // The whole point: `ctaLabel`/`ctaLink` pair by structure, not spelling.
    const source = `export default function Promo({ ctaLabel, ctaLink }) {
      return <ThemeLink link={ctaLink}>{ctaLabel}</ThemeLink>;
    }`;
    expect(resolve(source, "ctaLabel", ["ctaLink"])).toEqual(["ctaLink"]);
  });

  it("finds it when the label is passed as an attribute too", () => {
    const source = `export default function Promo({ ctaLabel, ctaLink }) {
      return <ThemeLink link={ctaLink} label={ctaLabel} />;
    }`;
    expect(resolve(source, "ctaLabel", ["ctaLink"])).toEqual(["ctaLink"]);
  });

  it("ignores a link the selected field has nothing to do with", () => {
    const source = `export default function Promo({ heading, ctaLink }) {
      return (
        <section>
          <h2>{heading}</h2>
          <ThemeLink link={ctaLink}>Go</ThemeLink>
        </section>
      );
    }`;
    expect(resolve(source, "heading", ["ctaLink"])).toEqual([]);
  });

  it("never returns the selected field itself", () => {
    const source = `export default function Promo({ cta }) {
      return <ThemeLink link={cta}>{cta.label}</ThemeLink>;
    }`;
    expect(resolve(source, "cta", ["cta"])).toEqual([]);
  });

  it("survives a source it cannot parse", () => {
    expect(resolve("export default function ( {", "label", ["link"])).toEqual(
      [],
    );
  });
});

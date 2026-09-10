// @vitest-environment node
/**
 * The parity comparison has to be able to blame the interpreter.
 *
 * Normalisation that removed too much would make every component "match" and
 * the whole suite would prove nothing, so what it drops is worth stating: only
 * things that carry no meaning in the DOM.
 */
import { describe, expect, it } from "vitest";
import { normalizeThemeMarkup } from "./theme-module-loader";

describe("normalising rendered markup", () => {
  it("treats two attribute orders as the same DOM", () => {
    // A component that computes one attribute then spreads the rest emits a
    // different order from one that spreads first. Neither is more correct.
    expect(normalizeThemeMarkup('<a href="/x" class="c">Go</a>')).toBe(
      normalizeThemeMarkup('<a class="c" href="/x">Go</a>'),
    );
  });

  it("still reports a different value", () => {
    expect(normalizeThemeMarkup('<a href="/x" class="c">Go</a>')).not.toBe(
      normalizeThemeMarkup('<a class="c" href="/y">Go</a>'),
    );
  });

  it("still reports a missing attribute", () => {
    expect(normalizeThemeMarkup('<a href="/x" class="c">Go</a>')).not.toBe(
      normalizeThemeMarkup('<a href="/x">Go</a>'),
    );
  });

  it("still reports a different element", () => {
    expect(normalizeThemeMarkup('<a href="/x">Go</a>')).not.toBe(
      normalizeThemeMarkup('<span href="/x">Go</span>'),
    );
  });

  it("still reports different text", () => {
    expect(normalizeThemeMarkup("<p>One</p>")).not.toBe(
      normalizeThemeMarkup("<p>Two</p>"),
    );
  });

  it("leaves a tag without attributes alone", () => {
    expect(normalizeThemeMarkup("<div><p>Hi</p></div>")).toBe(
      "<div><p>Hi</p></div>",
    );
  });

  it("keeps a value containing spaces intact", () => {
    expect(normalizeThemeMarkup('<a class="a b" href="/x">Go</a>')).toContain(
      'class="a b"',
    );
  });

  it("drops only the editor's own annotations", () => {
    expect(
      normalizeThemeMarkup(
        '<a data-morph-loc="1:1" data-storefront-field="label" href="/x">Go</a>',
      ),
    ).toBe('<a href="/x">Go</a>');
  });
});

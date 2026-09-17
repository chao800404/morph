import { describe, expect, it } from "vitest";
import { deriveThemeTokenClasses } from "./tailwind-theme-tokens";

/**
 * Reading a Theme's design tokens out of its own stylesheet.
 *
 * Tailwind v4 declares tokens as custom properties inside `@theme`, so the
 * stylesheet is the authority and this is only a reader. What each case here
 * guards is a way of reading it wrongly: taking a `:root` variable for a token,
 * taking a sub-property for a token, stopping at the first closing brace, or
 * offering the same utility twice.
 */

const values = (css: string) =>
  deriveThemeTokenClasses(css).map(({ value }) => value);

describe("deriving utilities from a Theme's @theme tokens", () => {
  it("maps each namespace to the utilities it names", () => {
    const classes = values(
      `@theme {
        --color-brand: oklch(0.7 0.1 200);
        --font-display: "Inter", sans-serif;
        --radius-card: 1rem;
        --shadow-panel: 0 1px 2px rgb(0 0 0 / 0.1);
        --text-hero: 3rem;
        --tracking-brand: 0.2em;
        --leading-brand: 1.4;
        --blur-brand: 6px;
        --animate-brand: brand 1s linear infinite;
        --ease-brand: cubic-bezier(0.4, 0, 0.2, 1);
        --container-prose: 65ch;
      }`,
    );

    expect(classes).toContain("bg-brand");
    expect(classes).toContain("text-brand");
    expect(classes).toContain("border-brand");
    expect(classes).toContain("from-brand");
    expect(classes).toContain("font-display");
    expect(classes).toContain("rounded-card");
    expect(classes).toContain("shadow-panel");
    expect(classes).toContain("text-hero");
    expect(classes).toContain("tracking-brand");
    expect(classes).toContain("leading-brand");
    expect(classes).toContain("blur-brand");
    expect(classes).toContain("animate-brand");
    expect(classes).toContain("ease-brand");
    expect(classes).toContain("max-w-prose");
    // Hyphenated names keep their shape.
    expect(values(`@theme { --color-red-500: red; }`)).toContain("bg-red-500");
  });

  it("ignores custom properties outside a @theme block", () => {
    // `:root` variables are not Tailwind tokens, however theme-shaped they look.
    expect(
      values(`:root { --color-brand: red; --radius-card: 1rem; }`),
    ).toEqual([]);
  });

  it("ignores sub-properties and Tailwind's own bookkeeping", () => {
    const classes = values(
      `@theme {
        --text-xl--line-height: calc(1.75 / 1.25);
        --default-font-family: --theme(--font-sans, initial);
        --font-sans--font-feature-settings: normal;
      }`,
    );

    expect(classes).toEqual([]);
  });

  it("reads tokens that follow a nested block", () => {
    // A non-greedy `@theme {...}` match stops at the keyframes' first closing
    // brace, which would drop every token after it.
    const classes = values(
      `@theme {
        --animate-brand: brand 1s linear;
        @keyframes brand { to { opacity: 0; } }
        --color-after: red;
      }`,
    );

    expect(classes).toContain("animate-brand");
    expect(classes).toContain("bg-after");
  });

  it("reads every block and offers a utility once", () => {
    const classes = values(
      `@theme { --color-brand: red; }
       @theme inline { --color-brand: blue; --radius-card: 1rem; }`,
    );

    expect(classes.filter((value) => value === "bg-brand")).toHaveLength(1);
    expect(classes).toContain("rounded-card");
  });
});

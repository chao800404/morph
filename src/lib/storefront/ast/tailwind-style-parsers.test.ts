import { describe, expect, it } from "vitest";
import {
  parseTailwindBoxShadow,
  parseTailwindCursor,
  parseTailwindTransition,
} from "./tailwind-style-parsers";

/**
 * What the Inspector's newer controls read back off a class list.
 *
 * These parsers exist because a computed style cannot answer the question they
 * are asked. A resolved `box-shadow` is geometry and colour that no longer says
 * which size produced it, and a resolved `transition` is a flattened shorthand.
 * The class list says what an author chose, so these read that — and the cases
 * below are the ones where reading it loosely would put a wrong value in front
 * of someone about to overwrite it.
 */

describe("reading a shadow size", () => {
  it("reads the size, in any variant position", () => {
    expect(parseTailwindBoxShadow("rounded-lg shadow-md bg-white")).toBe("md");
    expect(parseTailwindBoxShadow("md:shadow-xl")).toBe("xl");
    expect(parseTailwindBoxShadow("shadow-none")).toBe("none");
  });

  it("does not read a shadow colour as a size", () => {
    // `shadow-red-500` leaves the size where it was. Reporting it as one would
    // show a shadow the element does not have, and committing from that
    // reading would delete the colour.
    expect(parseTailwindBoxShadow("shadow-red-500")).toBeNull();
  });

  it("says nothing about a shadow it cannot represent", () => {
    expect(parseTailwindBoxShadow("shadow-[0_2px_8px_rgba(0,0,0,.2)]")).toBeNull();
    expect(parseTailwindBoxShadow("")).toBeNull();
    expect(parseTailwindBoxShadow(undefined)).toBeNull();
  });
});

describe("reading a cursor", () => {
  it("reads the keyword", () => {
    expect(parseTailwindCursor("flex cursor-pointer gap-2")).toBe("pointer");
    expect(parseTailwindCursor("hover:cursor-grab")).toBe("grab");
  });

  it("is not fooled by a word that merely contains one", () => {
    expect(parseTailwindCursor("cursor-pointer-ish")).toBeNull();
    expect(parseTailwindCursor("not-cursor-pointer")).toBeNull();
  });
});

describe("reading a transition", () => {
  /**
   * Bare `transition` is the form this codebase uses most, and it means the
   * default set. A control that read it as "none" would show the element as
   * having no transition while it visibly has one.
   */
  it("reads the bare form as the whole set", () => {
    expect(parseTailwindTransition("transition")).toBe("all");
    expect(parseTailwindTransition("rounded transition duration-150")).toBe(
      "all",
    );
  });

  it("reads a named set", () => {
    expect(parseTailwindTransition("transition-colors duration-150")).toBe(
      "colors",
    );
    expect(parseTailwindTransition("transition-none")).toBe("none");
  });

  it("does not read timing utilities as a set", () => {
    expect(parseTailwindTransition("duration-150 ease-out")).toBeNull();
  });
});

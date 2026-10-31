import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  previewSourceBoundaryOf,
  resolveSelectable,
  selectionMetadata,
} from "./preview-dom";

// L1.5a (docs/astro-theme-plan.md 3.6.2.2).

const NONCE = "0123456789abcdef";
const OTHER = "fedcba9876543210";
const open = (n: number, nonce = NONCE) =>
  `<!--morph:s ${nonce}:aaaaaaaa:${n}-->`;
const close = (n: number, nonce = NONCE) =>
  `<!--/morph:s ${nonce}:aaaaaaaa:${n}-->`;

beforeEach(() => {
  (globalThis as Record<string, unknown>).__morphPreviewSourceSelection = {
    nonce: NONCE,
  };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__morphPreviewSourceSelection;
  document.body.replaceChildren();
});

const at = (html: string, selector = "#target") => {
  document.body.innerHTML = html;
  return previewSourceBoundaryOf(document.querySelector(selector)!);
};

describe("a preview boundary candidate", () => {
  it("is selectable when paired, nested cleanly, unique and not empty", () => {
    expect(
      at(`${open(0)}<section><h2 id="target">a</h2></section>${close(0)}`),
    ).toEqual({
      marker: `${NONCE}:aaaaaaaa:0`,
      selectable: true,
      reason: null,
    });
  });

  it("names the innermost range, and spans every root of a component", () => {
    expect(
      at(
        `${open(0)}<div>${open(1)}<header></header><footer id="target"></footer>${close(1)}</div>${close(0)}`,
      )?.marker,
    ).toBe(`${NONCE}:aaaaaaaa:1`);
    expect(
      at(`${open(0)}<a></a>${close(0)}${open(1)}<b id="target"></b>${close(1)}`)
        ?.marker,
    ).toBe(`${NONCE}:aaaaaaaa:1`);
  });

  it("is not selectable when the browser moved one end (split)", () => {
    // What `<table><!--open--><tr>` parses to: the close lands in the tbody.
    const result = at(
      `<table>${open(0)}<tbody><tr id="target"><td>x</td></tr>${close(0)}</tbody></table>`,
    );
    expect(result).toEqual(
      expect.objectContaining({ selectable: false, reason: "unpaired" }),
    );
  });

  it("is not selectable when a range inside it was split by the browser", () => {
    // What `<p><!--open--><div>` parses to: the open stays in the closed <p>,
    // and the block and the close follow it.
    const result = at(
      `${open(0)}<main><p>${open(1)}</p><div id="target"></div>${close(1)}<p></p></main>${close(0)}`,
    );
    expect(result).toEqual({
      marker: `${NONCE}:aaaaaaaa:0`,
      selectable: false,
      reason: "split-inside",
    });
    // A balanced sibling range does not count as a split.
    expect(
      at(
        `${open(0)}<main>${open(1)}<p></p>${close(1)}<div id="target"></div></main>${close(0)}`,
      ),
    ).toEqual(expect.objectContaining({ selectable: true }));
  });

  it("is not selectable when ranges cross or repeat", () => {
    expect(
      at(
        `${open(0)}<i id="target"></i>${open(1)}<b></b>${close(0)}${close(1)}`,
      ),
    ).toEqual(
      expect.objectContaining({ selectable: false, reason: "crossing" }),
    );
    expect(
      at(
        `${open(0)}<i id="target"></i>${close(0)}${open(0)}<b></b>${close(0)}`,
      ),
    ).toEqual(
      expect.objectContaining({ selectable: false, reason: "duplicate" }),
    );
  });

  it("ignores markers of another nonce, and reports elements outside every range", () => {
    expect(
      at(`${open(0, OTHER)}<p id="target"></p>${close(0, OTHER)}`),
    ).toEqual({
      marker: null,
      selectable: false,
      reason: "outside",
    });
    expect(
      at(
        `${open(0)}${open(1, OTHER)}<p id="target"></p>${close(1, OTHER)}${close(0)}`,
      )?.marker,
    ).toBe(`${NONCE}:aaaaaaaa:0`);
  });

  it("is not reported at all outside the source-selection preview", () => {
    delete (globalThis as Record<string, unknown>)
      .__morphPreviewSourceSelection;
    expect(at(`${open(0)}<p id="target"></p>${close(0)}`)).toBeNull();
  });
});

describe("a source-located element without a Document section", () => {
  it("is selected by its file, in the source-selection preview only", () => {
    document.body.innerHTML = `<p id="target" data-morph-loc="src/pages/index.astro:3:1">x</p>`;
    const item = resolveSelectable(
      document.querySelector<HTMLElement>("#target")!,
    );
    expect(item?.sectionId).toBe("source:src/pages/index.astro");
    expect(selectionMetadata(item!).sourceFilePath).toBe(
      "src/pages/index.astro",
    );

    delete (globalThis as Record<string, unknown>)
      .__morphPreviewSourceSelection;
    expect(
      resolveSelectable(document.querySelector<HTMLElement>("#target")!)
        ?.sectionId ?? null,
    ).toBeNull();
  });

  it("gets no identity from a location outside `src/`", () => {
    document.body.innerHTML = `<p id="target" data-morph-loc="../x.astro:3:1">x</p>`;
    expect(
      resolveSelectable(document.querySelector<HTMLElement>("#target")!)
        ?.sectionId ?? null,
    ).toBeNull();
  });
});

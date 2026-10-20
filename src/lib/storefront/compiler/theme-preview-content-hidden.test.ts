import { describe, expect, it } from "vitest";
import { themePreviewContentModuleSource } from "./theme-preview-content";

/**
 * The frame's own content object for a hidden section (design v2, rule R4).
 *
 * A page renders a slot from `content.slots`; one listed in `hiddenSlots` is
 * not rendered. `updatePreviewContent` is the one place the page's editor
 * messages reach that object — the bridge and the early, pre-hydration
 * receiver both call it — so it is taken out of the module the preview really
 * runs, and only the page lookup around it stands in.
 *
 *   - A message without `enabled: true` never writes a listed slot.
 *   - `enabled: false` deletes the slot and lists the id.
 *   - `enabled: true` unlists the id and applies the props.
 */

type Content = { slots: Record<string, Record<string, unknown>>; hiddenSlots: string[] };
type Update = (
  sectionId: string,
  props?: Record<string, unknown>,
  enabled?: boolean,
  resetKeys?: string[],
) => void;

function frame(initial: Content): { content: Content; update: Update } {
  const source = themePreviewContentModuleSource();
  const start = source.indexOf("export function updatePreviewContent");
  const end = source.indexOf("// Below `updatePreviewContent`");
  if (start < 0 || end <= start) {
    throw new Error("the preview content module no longer has the update this test reads");
  }
  const body = source
    .slice(start, end)
    .replace("export function updatePreviewContent", "function updatePreviewContent");
  const content = JSON.parse(JSON.stringify(initial)) as Content;
  const update = new Function(
    "content",
    `${body}\nfunction currentPreviewContent() { return content; }\nreturn updatePreviewContent;`,
  )(content) as Update;
  return { content, update };
}

const STORED = { heading: "Stored heading", body: "Stored body" };
const visible = (): Content => ({ slots: { hero: { ...STORED } }, hiddenSlots: [] });
const hiddenInSnapshot = (): Content => ({ slots: {}, hiddenSlots: ["hero"] });

describe("U3: a listed slot is written only by a show", () => {
  it("drops a value edit, a signed repost and a reset after a hide", () => {
    const { content, update } = frame(visible());
    update("hero", undefined, false);
    expect(content.slots.hero).toBeUndefined();
    expect(content.hiddenSlots).toEqual(["hero"]);

    update("hero", { heading: "Late edit" });
    update("hero", { body: "Late signed" }, undefined);
    update("hero", {}, undefined, ["body"]);
    expect(content.slots.hero).toBeUndefined();
    expect(content.hiddenSlots).toEqual(["hero"]);
  });

  it("drops a value edit for a section the snapshot it loaded with already hides", () => {
    const { content, update } = frame(hiddenInSnapshot());
    update("hero", { heading: "Replayed while hidden" });
    expect(content.slots).toEqual({});
    expect(content.hiddenSlots).toEqual(["hero"]);
  });

  it("leaves a section that is not listed as it was", () => {
    const { content, update } = frame(visible());
    update("hero", { heading: "Edit" });
    expect(content.slots.hero).toEqual({ ...STORED, heading: "Edit" });
    update("hero", {}, undefined, ["body"]);
    expect(content.slots.hero).toEqual({ heading: "Edit" });
  });
});

describe("U4: a show restores exactly the props it sends", () => {
  it("after a hide", () => {
    const { content, update } = frame(visible());
    update("hero", undefined, false);
    update("hero", { heading: "Late edit" });
    const shown = { heading: "Shown heading", body: "Shown body", extra: 1 };
    update("hero", shown, true);
    expect(content.slots.hero).toEqual(shown);
    expect(content.hiddenSlots).toEqual([]);
  });

  it("for a section the snapshot hides", () => {
    const { content, update } = frame(hiddenInSnapshot());
    update("hero", { heading: "Shown" }, true);
    expect(content.slots.hero).toEqual({ heading: "Shown" });
    expect(content.hiddenSlots).toEqual([]);
  });

  it("(f) a duplicated show changes nothing", () => {
    const { content, update } = frame(hiddenInSnapshot());
    const shown = { heading: "Shown", body: "B" };
    update("hero", shown, true);
    update("hero", shown, true);
    expect(content.slots.hero).toEqual(shown);
    expect(content.hiddenSlots).toEqual([]);
  });
});

/**
 * (e) Every order the editor can produce. The editor's posts for one section
 * are a hide, a show (always with the props it composed), and value posts
 * with no `enabled`: an edit, a signed repost, a reset. Whatever order they
 * arrive in, the final content is decided by the last visibility message:
 * after a hide nothing; after a show its props with only the value posts that
 * came after it.
 */
type Message = Readonly<{
  name: string;
  props?: Record<string, unknown>;
  enabled?: boolean;
  resetKeys?: string[];
}>;
const MESSAGES: readonly Message[] = [
  { name: "hide", enabled: false },
  { name: "show", props: { heading: "Shown", body: "Shown body" }, enabled: true },
  { name: "edit", props: { heading: "Edited" } },
  { name: "signed", props: { body: "Signed body" } },
  { name: "reset", props: {}, resetKeys: ["body"] },
];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

/** Value posts folded onto a base, as a shown slot takes them. */
function fold(base: Record<string, unknown>, messages: readonly Message[]) {
  let slot = { ...base };
  for (const message of messages) {
    slot = { ...slot, ...message.props };
    for (const key of message.resetKeys ?? []) delete slot[key];
  }
  return slot;
}

describe("(e) the final content for every order", () => {
  const orders = permutations(MESSAGES).flatMap((order) =>
    // Every subset in its order too: a message the editor did not send.
    [order, ...order.map((_, skip) => order.filter((__, at) => at !== skip))],
  );

  it.each([
    ["visible", visible],
    ["hidden by the snapshot", hiddenInSnapshot],
  ] as const)("starting %s", (_label, initial) => {
    let checked = 0;
    for (const order of orders) {
      const { content, update } = frame(initial());
      for (const message of order) {
        update("hero", message.props, message.enabled, message.resetKeys);
      }
      const lastVisibility = order.reduce(
        (last, message, index) =>
          message.enabled === undefined ? last : index,
        -1,
      );
      const names = order.map((message) => message.name).join(",");
      const startsHidden = initial().hiddenSlots.includes("hero");
      if (
        (lastVisibility >= 0 && order[lastVisibility]!.enabled === false) ||
        (lastVisibility < 0 && startsHidden)
      ) {
        expect(content.slots.hero, names).toBeUndefined();
        expect(content.hiddenSlots, names).toEqual(["hero"]);
      } else if (lastVisibility >= 0) {
        expect(content.hiddenSlots, names).toEqual([]);
        expect(content.slots.hero, names).toEqual(
          fold(order[lastVisibility]!.props!, order.slice(lastVisibility + 1)),
        );
      } else {
        expect(content.hiddenSlots, names).toEqual([]);
        expect(content.slots.hero, names).toEqual(fold(STORED, order));
      }
      checked += 1;
    }
    expect(checked).toBe(orders.length);
  });
});

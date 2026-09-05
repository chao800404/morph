/**
 * Helper a Theme route calls to read the content for one slot.
 *
 * ```tsx
 * <Hero {...content("hero")} />
 * ```
 *
 * The slot id is the single binding between authored structure and stored
 * content: the route declares which slots exist and in what order, and the
 * Page Document holds only the values for them. Nothing has to be registered
 * anywhere for a customer-written component to become editable.
 */
export const THEME_CONTENT_SLOT_HELPER = "content";

/**
 * Helper a route calls to ask whether the author hid a section.
 *
 * Spreading props cannot cancel a render, so hiding has to be a question the
 * route asks rather than something the slot values can express.
 */
export const THEME_SECTION_HIDDEN_HELPER = "isSectionHidden";

/** Path of the platform-owned module that provides the helper to a Theme. */
export const THEME_CONTENT_MODULE_PATH = "src/morph/content.ts";

/**
 * Router hook a Theme's root route calls to read what its `beforeLoad` loaded.
 *
 * Production resolves it through TanStack Router. The Design preview has no
 * router and never runs `beforeLoad`, so it answers the call directly from the
 * Document instead — the two planes agree on the shape, not the mechanism.
 */
export const THEME_ROUTE_CONTEXT_HOOK = "useRouteContext";

/** Key the root route's context carries published slot values under. */
export const THEME_CONTENT_CONTEXT_KEY = "morphContent";

const SLOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const MAX_SLOT_ID_LENGTH = 64;
export const MAX_THEME_CONTENT_SLOTS = 200;

export type ThemeContentSlotValues = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

/**
 * Validates a slot id.
 *
 * Slot ids reach storage keys and DOM attributes, so anything outside a plain
 * identifier shape is refused rather than escaped at each use site.
 */
export function isValidThemeContentSlotId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SLOT_ID_LENGTH &&
    SLOT_ID_PATTERN.test(value)
  );
}

/**
 * Reads one slot's stored values.
 *
 * An unknown slot resolves to an empty object rather than throwing: a route may
 * legitimately declare a slot before any content has been authored for it, and
 * the component's own prop defaults are the correct result in that case.
 */
export function resolveThemeContentSlot(
  slots: ThemeContentSlotValues | undefined,
  slotId: unknown,
): Readonly<Record<string, unknown>> {
  if (!slots || !isValidThemeContentSlotId(slotId)) return {};
  const values = slots[slotId];
  return values && typeof values === "object" && !Array.isArray(values)
    ? values
    : {};
}

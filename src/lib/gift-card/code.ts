const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Most gift cards one order may issue.
 *
 * Every card is three statements in the order's single D1 batch, and that batch
 * is what guarantees an order never exists without its cards. An unbounded
 * quantity would push the batch past D1's per-invocation limits and fail the
 * whole checkout after payment was authorized, so the limit is checked before
 * anything is written.
 */
export const GIFT_CARD_MAX_UNITS_PER_ORDER = 50;

/** Generate the same human-readable credential for admin and auto-issued cards. */
export const createGiftCardCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const characters = Array.from(bytes, (byte) => alphabet[byte & 31]);
  const sections = characters.join("").match(/.{1,4}/g) ?? [];
  return `GIFT-${sections.join("-")}`;
};

export const normalizeGiftCardCode = (code: string) =>
  code.trim().toUpperCase();

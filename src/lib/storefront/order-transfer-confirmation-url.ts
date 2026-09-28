/** Build a confirmation link only from a hostname read from an active domain row. */
export function buildOrderTransferConfirmationUrl(
  hostname: string | null,
  orderId: string,
  token: string,
): string | null {
  const host = hostname?.trim().toLowerCase();
  if (
    !host ||
    !/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)(?::\d{1,5})?$/.test(
      host,
    )
  ) {
    return null;
  }

  try {
    const isLocalhost =
      host === "localhost" ||
      host.startsWith("localhost:") ||
      host.endsWith(".localhost") ||
      host.includes(".localhost:");
    const url = new URL(`${isLocalhost ? "http" : "https"}://${host}`);
    if (url.host !== host || url.username || url.password) return null;
    url.pathname = "/order-transfer";
    url.searchParams.set("order_id", orderId);
    // The token lives in the URL fragment so it is not sent in HTTP requests
    // or Referer headers before the page removes it from the address bar.
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  } catch {
    return null;
  }
}

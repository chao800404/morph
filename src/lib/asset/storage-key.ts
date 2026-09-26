/**
 * Where a library asset's bytes live in R2: its stored URL without the
 * leading slash, under `assets/`. Older rows store the key without the
 * prefix; newer ones as the delivery path `/assets/<id>.<ext>`.
 */
export function assetStorageKey(url: string): string {
  const key = url.replace(/^\/+/, "");
  return key.startsWith("assets/") ? key : `assets/${key}`;
}

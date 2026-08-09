import type { ProductSkuConfig } from "@/lib/config/create-config";

export interface SkuSource {
  product: string;
  variant: string;
  options: string[];
  index: number;
}

const DEFAULT_POLICY = {
  autoGenerate: true,
  pattern: "{product}-{options}",
  separator: "-",
  casing: "upper",
  suffixLength: 2,
} as const;

const randomToken = (length: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
};

const segment = (value: string, separator: string): string =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, separator)
    .replace(
      new RegExp(
        `^${separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+|${separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+$`,
        "g",
      ),
      "",
    );

export const formatSku = (
  source: SkuSource,
  configured: ProductSkuConfig = {},
): string => {
  const policy = { ...DEFAULT_POLICY, ...configured };
  const separator = /^[A-Za-z0-9]$/.test(policy.separator)
    ? "-"
    : policy.separator.slice(0, 1) || "-";
  const suffixLength = Math.min(8, Math.max(2, policy.suffixLength));
  const values: Record<string, string> = {
    product: segment(source.product, separator),
    variant: segment(source.variant, separator),
    options: source.options.map((value) => segment(value, separator)).filter(Boolean).join(separator),
    index: String(source.index + 1).padStart(suffixLength, "0"),
    random: randomToken(suffixLength),
  };

  let sku = policy.pattern.replace(
    /\{(product|variant|options|index|random)\}/g,
    (_, token: string) => values[token] ?? "",
  );
  sku = segment(sku, separator) || `SKU${separator}${values.index}`;
  if (policy.casing === "upper") sku = sku.toUpperCase();
  if (policy.casing === "lower") sku = sku.toLowerCase();
  return sku.slice(0, 100);
};

export const createUniqueSku = async (
  source: SkuSource,
  configured: ProductSkuConfig | undefined,
  isTaken: (sku: string) => Promise<boolean>,
): Promise<string | null> => {
  const policy = { ...DEFAULT_POLICY, ...configured };
  if (!policy.autoGenerate) return null;

  const base = formatSku(source, policy);
  if (!(await isTaken(base))) return base;

  const width = Math.min(8, Math.max(2, policy.suffixLength));
  for (let number = 2; number < 10 ** width; number += 1) {
    const suffix = String(number).padStart(width, "0");
    const candidate = `${base.slice(0, 99 - width)}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error("Could not generate a unique SKU");
};

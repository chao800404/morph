const encoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const randomHex = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return bytesToHex(bytes).slice(0, length);
};

export const hashPublishableKey = async (token: string, salt: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: 100_000,
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
};

export const parsePublishableKeyId = (token: string): string | null => {
  const match = /^pk_([0-9a-f-]{36})_[0-9a-f]{48}$/.exec(token);
  return match?.[1] ?? null;
};

export const createPublishableKey = async () => {
  const id = crypto.randomUUID();
  const token = `pk_${id}_${randomHex(48)}`;
  const salt = randomHex(32);
  return {
    id,
    token,
    salt,
    hash: await hashPublishableKey(token, salt),
    redacted: `${token.slice(0, 11)}...${token.slice(-4)}`,
  };
};

export const verifyPublishableKey = async (
  token: string,
  salt: string,
  expectedHash: string,
) => {
  const actual = await hashPublishableKey(token, salt);
  if (actual.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
};

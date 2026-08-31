import type { ThemeCompilerInput } from "./theme-compiler.types";

/**
 * Computes a deterministic string representation of theme virtual filesystem.
 * Files are sorted by path to ensure consistent order regardless of input permutation.
 */
export function serializeCompilerInput(
  input: ThemeCompilerInput,
  compilerIdentity?: { id?: string; version?: string },
): string {
  const sortedFiles = [...input.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const sortedDependencies = input.dependencies
    ? Object.fromEntries(
        Object.entries(input.dependencies).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      )
    : undefined;
  const payload = {
    compilerId: compilerIdentity?.id ?? input.compilerId ?? "tailwind-browser",
    compilerVersion:
      compilerIdentity?.version ?? input.compilerVersion ?? "4.1.17",
    entry: input.entry ?? "src/pages/index.tsx",
    ...(sortedDependencies ? { dependencies: sortedDependencies } : {}),
    files: sortedFiles.map((f) => ({
      path: f.path,
      content: f.content,
    })),
  };
  return JSON.stringify(payload);
}

/**
 * Pure JS SHA-256 implementation for synchronous, universal, 100% deterministic
 * cryptographic hashing across all runtimes (Browser, Node, Vitest, Cloudflare Worker).
 */
export function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  let i: number;
  let j: number;
  let result = "";

  const words: number[] = [];

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0x0bef9a3f, 0xc67178f2,
  ];

  // Convert UTF-8 / ASCII string to word array
  let currentByte = 0;
  for (i = 0; i < ascii.length; i++) {
    const code = ascii.charCodeAt(i);
    if (code < 128) {
      words[currentByte >> 2] |= code << (24 - (currentByte % 4) * 8);
      currentByte++;
    } else if (code < 2048) {
      words[currentByte >> 2] |=
        (0xc0 | (code >> 6)) << (24 - (currentByte % 4) * 8);
      currentByte++;
      words[currentByte >> 2] |=
        (0x80 | (code & 0x3f)) << (24 - (currentByte % 4) * 8);
      currentByte++;
    } else {
      words[currentByte >> 2] |=
        (0xe0 | (code >> 12)) << (24 - (currentByte % 4) * 8);
      currentByte++;
      words[currentByte >> 2] |=
        (0x80 | ((code >> 6) & 0x3f)) << (24 - (currentByte % 4) * 8);
      currentByte++;
      words[currentByte >> 2] |=
        (0x80 | (code & 0x3f)) << (24 - (currentByte % 4) * 8);
      currentByte++;
    }
  }

  const bitLength = currentByte * 8;
  words[currentByte >> 2] |= 0x80 << (24 - (currentByte % 4) * 8);
  words[(((currentByte + 8) >> 6) << 4) + 15] = bitLength;

  const w = new Array(64);

  for (i = 0; i < words.length; i += 16) {
    const a = hash[0];
    const b = hash[1];
    const c = hash[2];
    const d = hash[3];
    const e = hash[4];
    const f = hash[5];
    const g = hash[6];
    const h = hash[7];

    let vA = a;
    let vB = b;
    let vC = c;
    let vD = d;
    let vE = e;
    let vF = f;
    let vG = g;
    let vH = h;

    for (j = 0; j < 64; j++) {
      if (j < 16) {
        w[j] = words[i + j] | 0;
      } else {
        const gamma0 =
          rightRotate(w[j - 15], 7) ^
          rightRotate(w[j - 15], 18) ^
          (w[j - 15] >>> 3);
        const gamma1 =
          rightRotate(w[j - 2], 17) ^
          rightRotate(w[j - 2], 19) ^
          (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + gamma0 + w[j - 7] + gamma1) | 0;
      }

      const s1 = rightRotate(vE, 6) ^ rightRotate(vE, 11) ^ rightRotate(vE, 25);
      const ch = (vE & vF) ^ (~vE & vG);
      const temp1 = (vH + s1 + ch + k[j] + w[j]) | 0;
      const s0 = rightRotate(vA, 2) ^ rightRotate(vA, 13) ^ rightRotate(vA, 22);
      const maj = (vA & vB) ^ (vA & vC) ^ (vB & vC);
      const temp2 = (s0 + maj) | 0;

      vH = vG;
      vG = vF;
      vF = vE;
      vE = (vD + temp1) | 0;
      vD = vC;
      vC = vB;
      vB = vA;
      vA = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + vA) | 0;
    hash[1] = (hash[1] + vB) | 0;
    hash[2] = (hash[2] + vC) | 0;
    hash[3] = (hash[3] + vD) | 0;
    hash[4] = (hash[4] + vE) | 0;
    hash[5] = (hash[5] + vF) | 0;
    hash[6] = (hash[6] + vG) | 0;
    hash[7] = (hash[7] + vH) | 0;
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const byte = (hash[i] >> (j * 8)) & 255;
      result += (byte < 16 ? "0" : "") + byte.toString(16);
    }
  }

  return result;
}

/**
 * Computes a deterministic SHA-256 input hash for ThemeCompilerInput.
 */
export function computeThemeInputHash(
  input: ThemeCompilerInput,
  compilerIdentity?: { id?: string; version?: string },
): string {
  const serialized = serializeCompilerInput(input, compilerIdentity);
  return sha256(serialized);
}

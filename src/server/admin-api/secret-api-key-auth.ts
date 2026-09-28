import { parseSecretApiKeyId } from "@/lib/api-key/publishable-key";

export type SecretApiKeyAuthDependencies = {
  findActiveSecretById(id: string): Promise<{
    id: string;
    hash: string;
    salt: string;
    createdBy: string;
  } | null>;
  findSecretOwner(userId: string): Promise<{
    id: string;
    role: string | null;
    banned: boolean | null;
  } | null>;
  verifyToken(token: string, salt: string, hash: string): Promise<boolean>;
  recordSecretUse(id: string): Promise<boolean>;
};

export type SecretApiKeyActor = { userId: string; role: "admin" };

const secretFromBasicCredential = (credential: string): string | null => {
  const direct = credential.trim();
  if (parseSecretApiKeyId(direct)) return direct;

  try {
    const decoded = atob(direct);
    if (parseSecretApiKeyId(decoded)) return decoded;
    // Older Medusa clients sent HTTP Basic's conventional `key:` pair.
    if (decoded.endsWith(":")) {
      const key = decoded.slice(0, -1);
      if (parseSecretApiKeyId(key)) return key;
    }
  } catch {
    // An unencoded secret token is the current Medusa format.
  }
  return null;
};

/**
 * Parse Medusa's Basic authorization form without accepting Bearer tokens.
 * The direct token form is current; base64-encoded tokens remain compatible
 * with older clients. The returned key is never persisted or logged here.
 */
export const parseSecretApiKeyAuthorization = (
  authorization: string | null,
): { token: string; id: string } | null => {
  if (!authorization) return null;
  const match = /^Basic\s+(.+)$/i.exec(authorization.trim());
  const credential = match?.[1];
  if (!credential) return null;
  const token = secretFromBasicCredential(credential);
  const id = token ? parseSecretApiKeyId(token) : null;
  return token && id ? { token, id } : null;
};

/**
 * Authenticate the key as its creating admin. Owner role is checked on every
 * request so removing admin access also disables every key they issued.
 */
export async function authenticateAdminSecretApiKey(
  authorization: string | null,
  dependencies: SecretApiKeyAuthDependencies,
): Promise<SecretApiKeyActor | null> {
  const parsed = parseSecretApiKeyAuthorization(authorization);
  if (!parsed) return null;

  const stored = await dependencies.findActiveSecretById(parsed.id);
  if (!stored) return null;
  if (!(await dependencies.verifyToken(parsed.token, stored.salt, stored.hash)))
    return null;

  const owner = await dependencies.findSecretOwner(stored.createdBy);
  const ownerRoles = owner?.role?.split(",").map((role) => role.trim()) ?? [];
  if (
    !owner ||
    owner.id !== stored.createdBy ||
    !ownerRoles.includes("admin") ||
    owner.banned
  )
    return null;
  if (!(await dependencies.recordSecretUse(stored.id))) return null;
  return { userId: owner.id, role: "admin" };
}

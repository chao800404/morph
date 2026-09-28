export interface SecretApiKeyDTO {
  id: string;
  title: string;
  redacted: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

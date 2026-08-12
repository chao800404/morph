export interface InviteDTO {
  id: string;
  email: string;
  accepted: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InviteRecordDTO extends InviteDTO {
  tokenHash: string;
}

export interface InviteListInput {
  query?: string;
  sortBy: "email" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

export interface InvitePageDTO {
  invites: InviteRecordDTO[];
  total: number;
}

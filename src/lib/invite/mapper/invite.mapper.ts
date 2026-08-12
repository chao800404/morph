import type { InviteDTO, InviteRecordDTO } from "../dto/invite.dto";

export interface InviteRow {
  id: string;
  email: string;
  token: string;
  accepted: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export const toInviteDTO = (row: InviteRow): InviteDTO => ({
  id: row.id,
  email: row.email,
  accepted: row.accepted,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toInviteRecordDTO = (row: InviteRow): InviteRecordDTO => ({
  ...toInviteDTO(row),
  tokenHash: row.token,
});

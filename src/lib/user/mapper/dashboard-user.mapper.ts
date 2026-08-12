import type {
  DashboardUserDTO,
  DashboardUserDetailDTO,
} from "../dto/dashboard-user.dto";
import type { Metadata } from "@/db/json";

export interface DashboardUserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "guest" | "user" | "admin" | null;
  banned: boolean | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardUserDetailRow extends DashboardUserRow {
  language: string | null;
  phoneNumber: string | null;
  metadata: Metadata | null;
}

export const toDashboardUserDTO = (
  row: DashboardUserRow,
): DashboardUserDTO => ({ ...row });

export const toDashboardUserDetailDTO = (
  row: DashboardUserDetailRow,
): DashboardUserDetailDTO => ({ ...row, metadata: row.metadata ?? {} });

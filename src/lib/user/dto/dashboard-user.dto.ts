export interface DashboardUserDTO {
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

export interface DashboardUserDetailDTO extends DashboardUserDTO {
  language: string | null;
  phoneNumber: string | null;
  metadata: Metadata;
}

export interface DashboardUserPageDTO {
  users: DashboardUserDTO[];
  total: number;
}

export interface DashboardUserListInput {
  query?: string;
  sortBy:
    | "name"
    | "email"
    | "firstName"
    | "lastName"
    | "createdAt"
    | "updatedAt";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}
import type { Metadata } from "@/db/json";

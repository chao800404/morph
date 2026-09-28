import type { InferSelectModel } from "drizzle-orm";
import type { customerGroups } from "@/db/customer.schema";

type CustomerGroupRecord = InferSelectModel<typeof customerGroups>;

export interface CustomerGroupListItemDTO {
  id: CustomerGroupRecord["id"];
  name: CustomerGroupRecord["name"];
  createdAt: CustomerGroupRecord["createdAt"];
  updatedAt: CustomerGroupRecord["updatedAt"];
  customerCount: number;
}

export interface CustomerGroupDetailDTO extends CustomerGroupListItemDTO {
  metadata: CustomerGroupRecord["metadata"];
}

export interface CustomerGroupMemberDTO {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  createdAt: string;
}

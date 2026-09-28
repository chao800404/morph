import type { InferSelectModel } from "drizzle-orm";
import type {
  customerAddresses,
  customerGroupCustomers,
  customerGroups,
  customers,
} from "@/db/customer.schema";
import type { orders } from "@/db/order.schema";

export type CustomerRecord = InferSelectModel<typeof customers>;
export type CustomerAddressRecord = InferSelectModel<typeof customerAddresses>;
export type CustomerGroupRecord = InferSelectModel<typeof customerGroups>;
export type CustomerGroupCustomerRecord = InferSelectModel<
  typeof customerGroupCustomers
>;

export interface CustomerOrderSummaryDTO {
  id: InferSelectModel<typeof orders>["id"];
  displayId: InferSelectModel<typeof orders>["displayId"];
  status: InferSelectModel<typeof orders>["status"];
  total: number;
  currencyCode: InferSelectModel<typeof orders>["currencyCode"];
  createdAt: InferSelectModel<typeof orders>["createdAt"];
}

export interface CustomerListItemDTO {
  id: CustomerRecord["id"];
  email: CustomerRecord["email"];
  firstName: CustomerRecord["firstName"];
  lastName: CustomerRecord["lastName"];
  companyName: CustomerRecord["companyName"];
  phone: CustomerRecord["phone"];
  hasAccount: CustomerRecord["hasAccount"];
  orderCount: number;
  createdAt: CustomerRecord["createdAt"];
  updatedAt: CustomerRecord["updatedAt"];
}

export interface CustomerAddressDTO {
  id: CustomerAddressRecord["id"];
  customerId: CustomerAddressRecord["customerId"];
  addressName: CustomerAddressRecord["addressName"];
  isDefaultShipping: CustomerAddressRecord["isDefaultShipping"];
  isDefaultBilling: CustomerAddressRecord["isDefaultBilling"];
  company: CustomerAddressRecord["company"];
  firstName: CustomerAddressRecord["firstName"];
  lastName: CustomerAddressRecord["lastName"];
  address1: CustomerAddressRecord["address1"];
  address2: CustomerAddressRecord["address2"];
  city: CustomerAddressRecord["city"];
  countryCode: CustomerAddressRecord["countryCode"];
  province: CustomerAddressRecord["province"];
  postalCode: CustomerAddressRecord["postalCode"];
  phone: CustomerAddressRecord["phone"];
  metadata: CustomerAddressRecord["metadata"];
  createdAt: CustomerAddressRecord["createdAt"];
  updatedAt: CustomerAddressRecord["updatedAt"];
}

export interface CustomerGroupDTO {
  id: CustomerGroupRecord["id"];
  name: CustomerGroupRecord["name"];
}

export interface CustomerDetailDTO extends CustomerListItemDTO {
  metadata: CustomerRecord["metadata"];
  addresses: CustomerAddressDTO[];
  groups: CustomerGroupDTO[];
  recentOrders: CustomerOrderSummaryDTO[];
}

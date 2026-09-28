import type { CustomerDetailDTO } from "@/lib/customer/dto/customer.dto";
import type { FormField } from "@/lib/validations/form";

type CustomerFormValues = Pick<
  CustomerDetailDTO,
  | "email"
  | "firstName"
  | "lastName"
  | "companyName"
  | "phone"
  | "hasAccount"
> & { metadata?: CustomerDetailDTO["metadata"] };

export const customerFormFields = (
  values?: CustomerFormValues,
): FormField[] => [
  {
    type: "input",
    name: "email",
    label: "Email",
    inputType: "email",
    value: values?.email ?? "",
    placeholder: "customer@example.com",
    autoFocus: true,
    optional: true,
    disabled: values?.hasAccount,
    description: values?.hasAccount
      ? "Change this address through the authenticated customer account flow."
      : undefined,
  },
  {
    type: "input",
    name: "firstName",
    label: "First name",
    value: values?.firstName ?? "",
    optional: true,
  },
  {
    type: "input",
    name: "lastName",
    label: "Last name",
    value: values?.lastName ?? "",
    optional: true,
  },
  {
    type: "input",
    name: "companyName",
    label: "Company",
    value: values?.companyName ?? "",
    optional: true,
  },
  {
    type: "phone",
    name: "phone",
    label: "Phone",
    value: values?.phone ?? "",
    optional: true,
  },
];

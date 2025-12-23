import { AVAILABLE_LANGUAGES } from "@/lib/config/localization";

export const PROFILE_INFORMATION_FIELDS = [
  {
    key: "name",
    label: "Name",
    type: "text",
  },
  {
    key: "email",
    label: "Email",
    type: "email",
    disabled: true,
  },
  {
    key: "language",
    label: "Language",
    type: "select",
    options: AVAILABLE_LANGUAGES.map((lang) => ({
      label: lang.nativeName,
      value: lang.code,
    })),
  },
  {
    key: "role",
    label: "Role",
    type: "text",
    disabled: true,
  },
] as const;

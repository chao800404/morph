import type { EditCardField } from "../../../../_components/card/edit-card/edit-card";

export const PROFILE_INFORMATION_FIELDS: EditCardField[] = [
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
        type: "language",
    },
    {
        key: "role",
        label: "Role",
        type: "text",
        disabled: true,
    },
];

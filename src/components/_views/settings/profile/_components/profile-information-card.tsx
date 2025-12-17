import { updateProfile } from "@/actions/auth/update-auth";
import { EditCard, EditCardField } from "../../../../_components/card/edit-card/edit-card";
import type { ProfileCardComponentProps } from "../_config/profile-card.types";
import { PROFILE_INFORMATION_FIELDS } from "../_config/profile-information.fields";

import { getLanguageName } from "@/lib/config/localization";

// ...

export const ProfileInformationCard = ({ slug, label, description, session }: ProfileCardComponentProps) => {
    const fields: EditCardField[] = PROFILE_INFORMATION_FIELDS.map(field => {
        let value = "";
        let displayValue: string | undefined;

        if (field.key === "language") {
            value = session.user.language || "";
            displayValue = value ? getLanguageName(value) : "";
        } else if (field.key in session.user) {
            const key = field.key as keyof typeof session.user;
            const fieldValue = session.user[key];
            value = typeof fieldValue === "string" ? fieldValue : "";
        }

        const { validate, ...fieldConfig } = field;

        return {
            ...fieldConfig,
            value,
            displayValue,
        } satisfies EditCardField;
    });

    return <EditCard id={slug} title={label} description={description} fields={fields} onSave={updateProfile} />;
};

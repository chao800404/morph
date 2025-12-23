import { getLanguageName } from "@/lib/config/localization";

import { updateProfile } from "@/server/auth/update-profile.serverFn";
import { EditCard, type EditCardField } from "../../../../edit-card/edit-card";
import { ProfileCardComponentProps } from "../_config/profile-card.types";
import { PROFILE_INFORMATION_FIELDS } from "../_config/profile.config";

export const ProfileInformationCard = ({
  slug,
  label,
  description,
  session,
}: ProfileCardComponentProps) => {
  // session is guaranteed here by the parent component, but for TS:
  if (!session?.user) return null;

  const fields: EditCardField[] = PROFILE_INFORMATION_FIELDS.map((field) => {
    let value = "";
    let displayValue: string | undefined;

    if (field.key === "language") {
      value = (session.user as any).language || "";
      displayValue = value ? getLanguageName(value) : "";
    } else if (field.key in session.user) {
      const key = field.key as keyof typeof session.user;
      const fieldValue = session.user[key];
      value = typeof fieldValue === "string" ? fieldValue : "";
    }

    const { ...fieldConfig } = field;

    return {
      ...fieldConfig,
      value,
      displayValue,
    } as EditCardField;
  });

  return (
    <EditCard
      id={slug}
      title={label}
      description={description}
      fields={fields}
      onSave={async (formData) => {
        const result = await updateProfile({ data: formData });
        console.log(result);
        return result as any;
      }}
    />
  );
};

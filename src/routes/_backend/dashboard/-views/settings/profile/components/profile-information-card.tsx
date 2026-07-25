import { getLanguageName } from "@/lib/config/localization";
import {
  EditCard,
  EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { updateProfile } from "@/server/auth/update-profile.serverFn";
import { ProfileCardComponentProps } from "../config/profile-card.types";
import { PROFILE_INFORMATION_FIELDS } from "../config/profile.config";

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
      value = session.user.language || "";
      displayValue = value ? getLanguageName(value) : "";
    } else if (field.key === "phone") {
      value = session.user.phoneNumber || "";
    } else if (field.key in session.user) {
      const key = field.key as keyof typeof session.user;
      const fieldValue = session.user[key];
      value = typeof fieldValue === "string" ? fieldValue : "";
    }

    const country = session.session.country?.toUpperCase() || "Unknown";

    return {
      ...field,
      value,
      displayValue,
      ...(field.key === "phone" && country
        ? { defaultCountry: country }
        : {}),
    };
  });

  return (
    <EditCard
      id={slug}
      title={label}
      description={description}
      fields={fields}
      onSave={async (formData) => {
        const result = await updateProfile({ data: formData });
        // `ActionState.success` is optional; `EditCardState` requires it.
        return { ...result, success: result.success ?? false };
      }}
    />
  );
};

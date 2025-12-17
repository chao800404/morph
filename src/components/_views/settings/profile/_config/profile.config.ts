

import type { ComponentType } from "react";
import { ProfileInformationCard } from "../_components/profile-information-card";
import { ProfilePasswordCard } from "../_components/profile-password-card";
import { ProfileSessionsCard } from "../_components/profile-sessions-card";
import type { ProfileCardComponentProps } from "./profile-card.types";

export interface ProfileCardSection {
    slug: string;
    label: string;
    description?: string;
    component: ComponentType<ProfileCardComponentProps>;
}

export interface ProfileConfig {
    slug: string;
    sections: ProfileCardSection[];
}

export const PROFILE_CONFIG: ProfileConfig = {
    slug: "profile",
    sections: [
        {
            slug: "profile-information",
            label: "Information",
            description: "Manage your profile details.",
            component: ProfileInformationCard,
        },
        {
            slug: "profile-password",
            label: "Password",
            description: "Change your password to keep your account secure.",
            component: ProfilePasswordCard,
        },
        {
            slug: "profile-sessions",
            label: "Active Sessions",
            description: "Manage your active sessions across different devices.",
            component: ProfileSessionsCard,
        },
    ],
};

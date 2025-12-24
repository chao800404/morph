import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { sessionQueries } from "../../../../-queries/auth.queries";
import { ProfileInformationCard } from "./_components/profile-information-card";
import { ProfilePasswordCard } from "./_components/profile-password-card";
import { ProfileSessionsCard } from "./_components/profile-sessions-card";

const routeApi = getRouteApi("/_backend/dashboard/settings/$slug");

const Profile = () => {
  const { session, publicURL } = routeApi.useRouteContext();
  const { data: sessionData } = useSuspenseQuery(sessionQueries.list());

  if (!session) return null;

  return (
    <section className="space-y-4 p-3 overflow-y-auto">
      <ProfileInformationCard
        slug="profile-information"
        label="Profile Information"
        description="Update your profile information"
        session={session}
      />
      <ProfilePasswordCard
        slug="profile-password"
        label="Profile Password"
        description="Update your profile password"
        session={session}
      />
      <ProfileSessionsCard
        publicURL={publicURL}
        slug="profile-sessions"
        label="Profile Sessions"
        description="Manage your profile sessions"
        session={session}
        sessions={sessionData.sessions}
        currentSessionId={sessionData.currentSessionId}
      />
    </section>
  );
};

export default Profile;

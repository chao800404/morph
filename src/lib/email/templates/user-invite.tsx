import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export default function UserInviteEmail({
  appName,
  inviteUrl,
}: {
  appName: string;
  inviteUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>You have been invited to {appName}</Preview>
      <Body style={{ backgroundColor: "#f5f5f5", fontFamily: "sans-serif" }}>
        <Container
          style={{
            margin: "40px auto",
            maxWidth: "520px",
            backgroundColor: "#ffffff",
            padding: "32px",
          }}
        >
          <Heading style={{ fontSize: "22px" }}>Join {appName}</Heading>
          <Text style={{ color: "#525252", lineHeight: "24px" }}>
            An administrator invited you to collaborate in the dashboard. This
            invitation expires in seven days.
          </Text>
          <Button
            href={inviteUrl}
            style={{
              backgroundColor: "#171717",
              color: "#ffffff",
              padding: "12px 18px",
              borderRadius: "6px",
            }}
          >
            Accept invitation
          </Button>
          <Text style={{ color: "#737373", fontSize: "12px" }}>
            If you were not expecting this invitation, you can ignore this
            email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

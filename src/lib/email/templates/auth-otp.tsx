import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface AuthOtpEmailProps {
  appName?: string;
  otp: string;
  purpose: string;
}

/** Email template for sign-in and email-verification OTPs. */
export default function AuthOtpEmail({
  appName = "Morph",
  otp,
  purpose,
}: AuthOtpEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your verification code for {appName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Heading style={heading}>{appName}</Heading>
            <Text style={copy}>
              Use the following code to {purpose}. This code expires shortly.
            </Text>
            <Text style={code}>{otp}</Text>
            <Text style={hint}>
              If you did not request this code, you can safely ignore this
              email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f4f4f4",
  color: "#212121",
};

const container = {
  maxWidth: "560px",
  margin: "0 auto",
  padding: "20px",
};

const section = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  padding: "40px 32px",
  textAlign: "center" as const,
};

const heading = {
  color: "#111827",
  fontSize: "24px",
  margin: "0 0 24px",
};

const copy = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.5",
};

const code = {
  backgroundColor: "#f3f4f6",
  borderRadius: "6px",
  color: "#111827",
  fontSize: "32px",
  fontWeight: "700",
  letterSpacing: "0.24em",
  margin: "24px 0",
  padding: "16px",
};

const hint = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.5",
};

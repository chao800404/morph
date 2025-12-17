import { Body, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from "@react-email/components";

interface PasswordResetEmailProps {
    verificationCode?: string;
    appName?: string;
    email?: string;
    logoUrl?: string;
}

export default function PasswordResetEmail({
    verificationCode,
    appName = "Medusa",
    email,
    logoUrl,
}: PasswordResetEmailProps) {
    return (
        <Html>
            <Head />
            <Body style={main}>
                <Preview>Reset your password for {appName}</Preview>
                <Container style={container}>
                    <Section style={coverSection}>
                        <Section style={imageSection}>
                            {logoUrl ? (
                                <Img
                                    src={logoUrl}
                                    width="80"
                                    height="80"
                                    alt={`${appName} Logo`}
                                    style={{ margin: "0 auto" }}
                                />
                            ) : (
                                <Heading style={logoText}>{appName}</Heading>
                            )}
                        </Section>
                        <Section style={upperSection}>
                            <Heading style={h1}>Reset Your Password</Heading>
                            <Text style={mainText}>
                                We received a request to reset the password for your account ({email}). Please enter the
                                following verification code when prompted. If you didn&apos;t request this password
                                reset, you can safely ignore this email.
                            </Text>
                            <table width="100%" cellPadding="0" cellSpacing="0" style={verificationSection}>
                                <tr>
                                    <td align="center">
                                        <Text style={verifyText}>Verification Code</Text>
                                        <table cellPadding="0" cellSpacing="0" style={codeBox}>
                                            <tr>
                                                <td align="center">
                                                    <Text style={codeText}>{verificationCode}</Text>
                                                </td>
                                            </tr>
                                        </table>
                                        <Text style={validityText}>(This code is valid for 5 minutes)</Text>
                                    </td>
                                </tr>
                            </table>
                        </Section>
                        <Hr />
                        <Section style={lowerSection}>
                            <Text style={cautionText}>
                                {appName} will never email you and ask you to disclose or verify your password, credit
                                card, or banking account number.
                            </Text>
                        </Section>
                    </Section>
                    <Text style={footerText}>
                        © {new Date().getFullYear()} {appName}. All rights reserved. Need help? Contact us at{" "}
                        <Link href={`mailto:support@${appName.toLowerCase()}.com`} style={link}>
                            support@{appName.toLowerCase()}.com
                        </Link>
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}

const main = {
    backgroundColor: "#fff",
    color: "#212121",
};

const container = {
    padding: "20px",
    margin: "0 auto",
    backgroundColor: "#eee",
};

const h1 = {
    color: "#333",
    fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "20px",
    fontWeight: "bold",
    marginBottom: "15px",
};

const link = {
    color: "#2754C5",
    fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "14px",
    textDecoration: "underline",
};

const text = {
    color: "#333",
    fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "14px",
    margin: "24px 0",
};

const imageSection = {
    padding: "20px 0",
    textAlign: "center" as const,
};

const logoText = {
    fontSize: "24px",
    fontWeight: "bold",
    margin: "0",
    fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
};

const coverSection = { backgroundColor: "#fff" };

const upperSection = { padding: "25px 35px" };

const lowerSection = { padding: "25px 35px" };

const footerText = {
    ...text,
    fontSize: "12px",
    padding: "0 20px",
};

const verifyText = {
    ...text,
    margin: 0,
    fontWeight: "bold",
    textAlign: "center" as const,
};

const codeText = {
    ...text,
    fontWeight: "bold",
    fontSize: "36px",
    margin: "10px 0",
    textAlign: "center" as const,
};

const validityText = {
    ...text,
    margin: "0px",
    textAlign: "center" as const,
};

const verificationSection = {
    width: "100%",
    margin: "30px 0",
};

const codeBox = {
    backgroundColor: "#f4f4f4",
    borderRadius: "4px",
    padding: "20px",
    margin: "10px auto",
    maxWidth: "280px",
};

const mainText = { ...text, marginBottom: "14px" };

const cautionText = { ...text, margin: "0px" };

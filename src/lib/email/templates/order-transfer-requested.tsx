import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export default function OrderTransferRequestedEmail({
  appName,
  orderDisplayId,
  orderId,
  targetEmail,
  description,
  token,
  confirmationUrl,
}: {
  appName: string;
  orderDisplayId: number;
  orderId: string;
  targetEmail: string;
  description: string | null;
  token: string;
  confirmationUrl: string | null;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`Confirm ownership of order #${orderDisplayId}`}</Preview>
      <Body
        style={{
          backgroundColor: "#f5f5f5",
          color: "#171717",
          fontFamily: "sans-serif",
        }}
      >
        <Container
          style={{
            margin: "32px auto",
            maxWidth: "560px",
            backgroundColor: "#ffffff",
            padding: "32px",
          }}
        >
          <Section>
            <Heading style={{ fontSize: "22px" }}>{appName}</Heading>
            <Heading as="h2" style={{ fontSize: "18px" }}>
              Confirm your order
            </Heading>
            <Text style={{ lineHeight: "24px" }}>
              Someone signed in with this verified email and requested to add
              order #{orderDisplayId} to the account for {targetEmail}. Enter
              the code below to confirm the transfer. It expires in 30
              minutes.
            </Text>
            <Text style={{ color: "#737373", fontSize: "13px" }}>
              Order reference: {orderId}
            </Text>
            {description ? (
              <Text style={{ lineHeight: "24px" }}>
                Message from the requester: {description}
              </Text>
            ) : null}
            <Text
              style={{
                backgroundColor: "#f5f5f5",
                fontFamily: "monospace",
                fontSize: "18px",
                letterSpacing: "2px",
                padding: "16px",
                textAlign: "center",
              }}
            >
              {token}
            </Text>
            {confirmationUrl ? (
              <Button
                href={confirmationUrl}
                style={{
                  backgroundColor: "#171717",
                  color: "#ffffff",
                  display: "inline-block",
                  fontSize: "14px",
                  padding: "12px 18px",
                  textDecoration: "none",
                }}
              >
                Review order transfer
              </Button>
            ) : (
              <Text style={{ lineHeight: "24px" }}>
                Open your store’s order transfer page and enter the order
                reference and code above.
              </Text>
            )}
            <Text style={{ color: "#737373", fontSize: "13px" }}>
              If you did not make this request, ignore this email. The order
              will remain unchanged.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

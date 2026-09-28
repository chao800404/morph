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

export interface ClaimEmailItem {
  title: string;
  sku: string | null;
  quantity: number;
}

export default function OrderClaimCreatedEmail({
  appName,
  orderDisplayId,
  claimDisplayId,
  claimType,
  requiresReturn,
  refundAmount,
  inboundItems,
  outboundItems,
  returnShipping,
  outboundShipping,
}: {
  appName: string;
  orderDisplayId: number;
  claimDisplayId: number;
  claimType: "refund" | "replace";
  requiresReturn: boolean;
  refundAmount: string | null;
  inboundItems: ClaimEmailItem[];
  outboundItems: ClaimEmailItem[];
  returnShipping: { name: string; amount: string } | null;
  outboundShipping: { name: string; amount: string } | null;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`${claimType === "refund" ? "Refund" : "Replacement"} claim #${claimDisplayId} for order #${orderDisplayId}`}</Preview>
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
              {claimType === "refund"
                ? "Your refund claim is recorded"
                : "Your replacement claim is confirmed"}
            </Heading>
            <Text style={{ color: "#525252", lineHeight: "24px" }}>
              Claim #{claimDisplayId} has been recorded for order #
              {orderDisplayId}.
            </Text>
          </Section>
          {claimType === "refund" && refundAmount ? (
            <Section>
              <Heading as="h3" style={{ fontSize: "16px" }}>
                Refund due
              </Heading>
              <Text style={rowStyle}>{refundAmount}</Text>
              <Text style={{ ...rowStyle, color: "#737373", fontSize: "13px" }}>
                This claim records the refund amount due. No payment refund has
                been processed.
              </Text>
            </Section>
          ) : null}
          {inboundItems.length ? (
            <Section>
              <Heading as="h3" style={{ fontSize: "16px" }}>
                {requiresReturn
                  ? "Items to return"
                  : "Items covered by this claim"}
              </Heading>
              {inboundItems.map((item, index) => (
                <Text key={`${item.title}-${index}`} style={rowStyle}>
                  {item.title}
                  {item.sku ? ` (${item.sku})` : ""} · {item.quantity}
                </Text>
              ))}
            </Section>
          ) : null}
          {claimType === "replace" ? (
            <Section>
              <Heading as="h3" style={{ fontSize: "16px" }}>
                Replacement items
              </Heading>
              {outboundItems.map((item, index) => (
                <Text key={`${item.title}-${index}`} style={rowStyle}>
                  {item.title}
                  {item.sku ? ` (${item.sku})` : ""} · {item.quantity}
                </Text>
              ))}
            </Section>
          ) : null}
          {returnShipping || outboundShipping ? (
            <Section>
              <Heading as="h3" style={{ fontSize: "16px" }}>
                Shipping
              </Heading>
              {returnShipping ? (
                <Text style={rowStyle}>
                  Return shipping: {returnShipping.name} ·{" "}
                  {returnShipping.amount}
                </Text>
              ) : null}
              {outboundShipping ? (
                <Text style={rowStyle}>
                  Outbound shipping: {outboundShipping.name} ·{" "}
                  {outboundShipping.amount}
                </Text>
              ) : null}
              <Text style={{ ...rowStyle, color: "#737373", fontSize: "13px" }}>
                Shipping amounts are recorded with the claim. Any payment
                adjustment is handled separately.
              </Text>
            </Section>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}

const rowStyle = {
  color: "#404040",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "4px 0",
};

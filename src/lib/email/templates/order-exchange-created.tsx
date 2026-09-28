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

export interface ExchangeEmailItem {
  title: string;
  sku: string | null;
  quantity: number;
  unitPrice?: string;
}

export default function OrderExchangeCreatedEmail({
  appName,
  orderDisplayId,
  exchangeDisplayId,
  inboundItems,
  outboundItems,
  returnShipping,
  outboundShipping,
  differenceDue,
}: {
  appName: string;
  orderDisplayId: number;
  exchangeDisplayId: number;
  inboundItems: ExchangeEmailItem[];
  outboundItems: ExchangeEmailItem[];
  returnShipping: { name: string; amount: string } | null;
  outboundShipping: { name: string; amount: string } | null;
  differenceDue: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`Exchange #${exchangeDisplayId} for order #${orderDisplayId}`}</Preview>
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
              Your exchange is confirmed
            </Heading>
            <Text style={{ color: "#525252", lineHeight: "24px" }}>
              Exchange #{exchangeDisplayId} has been created for order #
              {orderDisplayId}.
            </Text>
          </Section>
          <Section>
            <Heading as="h3" style={{ fontSize: "16px" }}>
              Items to return
            </Heading>
            {inboundItems.map((item, index) => (
              <Text key={`${item.title}-${index}`} style={rowStyle}>
                {item.title}
                {item.sku ? ` (${item.sku})` : ""} · {item.quantity}
                {item.unitPrice ? ` × ${item.unitPrice}` : ""}
              </Text>
            ))}
          </Section>
          <Section>
            <Heading as="h3" style={{ fontSize: "16px" }}>
              Replacement items
            </Heading>
            {outboundItems.map((item, index) => (
              <Text key={`${item.title}-${index}`} style={rowStyle}>
                {item.title}
                {item.sku ? ` (${item.sku})` : ""} · {item.quantity} ×{" "}
                {item.unitPrice}
              </Text>
            ))}
          </Section>
          <Section>
            <Heading as="h3" style={{ fontSize: "16px" }}>
              Shipping and exchange balance
            </Heading>
            {returnShipping ? (
              <Text style={rowStyle}>
                Return shipping: {returnShipping.name} · {returnShipping.amount}
              </Text>
            ) : null}
            {outboundShipping ? (
              <Text style={rowStyle}>
                Outbound shipping: {outboundShipping.name} ·{" "}
                {outboundShipping.amount}
              </Text>
            ) : null}
            <Text style={rowStyle}>Exchange balance: {differenceDue}</Text>
            <Text style={{ ...rowStyle, color: "#737373", fontSize: "13px" }}>
              The exchange balance is shown for reference. Any required payment
              adjustment will be handled separately.
            </Text>
          </Section>
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

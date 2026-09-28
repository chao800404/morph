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

export interface PlacedOrderEmailItem {
  title: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
}

export default function OrderPlacedEmail({
  appName,
  orderDisplayId,
  items,
  total,
}: {
  appName: string;
  orderDisplayId: number;
  items: PlacedOrderEmailItem[];
  total: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`Order #${orderDisplayId} received`}</Preview>
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
              Your order is confirmed
            </Heading>
            <Text style={rowStyle}>
              We received order #{orderDisplayId}. Here is a summary for your
              records.
            </Text>
          </Section>
          <Section>
            <Heading as="h3" style={{ fontSize: "16px" }}>
              Items
            </Heading>
            {items.map((item, index) => (
              <Text key={`${item.title}-${index}`} style={rowStyle}>
                {item.title}
                {item.sku ? ` (${item.sku})` : ""} · {item.quantity} ×{" "}
                {item.unitPrice}
              </Text>
            ))}
          </Section>
          <Section>
            <Text style={{ ...rowStyle, fontWeight: 700 }}>
              Order total: {total}
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

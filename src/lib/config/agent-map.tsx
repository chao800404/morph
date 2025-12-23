import { IphoneCheckIcon } from "@/components/ui/icons/iphone-check-icon";
import { MonitorCheckIcon } from "@/components/ui/icons/monitor-check-icon";
import { TabletCheckIcon } from "@/components/ui/icons/tablet-check-icon";
import { Monitor, Smartphone, Tablet } from "lucide-react";

export function getDeviceIcon(userAgent?: string | null, active?: boolean) {
  if (!userAgent) return <span>-</span>;

  const iphone = active ? <IphoneCheckIcon /> : <Smartphone />;
  const laptop = active ? <MonitorCheckIcon /> : <Monitor />;
  const tablet = active ? <TabletCheckIcon /> : <Tablet />;

  let device: React.ReactNode = laptop;

  if (userAgent.includes("iPhone")) {
    device = iphone;
  } else if (userAgent.includes("iPad")) {
    device = tablet;
  } else if (userAgent.includes("Android")) {
    device = iphone;
  } else if (userAgent.includes("Windows")) {
    device = laptop;
  } else if (userAgent.includes("Mac")) {
    device = laptop;
  } else if (userAgent.includes("Linux")) {
    device = laptop;
  } else {
    return <span>-</span>;
  }

  return device;
}

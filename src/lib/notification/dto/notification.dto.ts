import type { NotificationStatus } from "../types";

export interface OrderNotificationDTO {
  id: string;
  recipient: string;
  channel: string;
  template: string | null;
  status: NotificationStatus;
  triggerType: string | null;
  externalId: string | null;
  canRetry: boolean;
  createdAt: string;
  updatedAt: string;
}

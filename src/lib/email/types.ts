export interface EmailAdapter {
  send(params: SendEmailParams): Promise<SendEmailResult>;
  sendBatch?(params: SendEmailParams[]): Promise<SendEmailResult[]>;
}

export interface SendEmailParams {
  from?: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailConfig {
  from: string;
  replyTo?: string;
}

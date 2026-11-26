export interface NewsletterItem {
  _id: string;
  gmailMessageId: string;
  subject: string;
  sender: string;
  snippet: string;
  bodyHtml?: string;
  labels: string[];
  isRead: boolean;
  receivedAt: string;
}

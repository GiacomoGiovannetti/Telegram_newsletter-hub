import { Document, Schema, model } from 'mongoose';

export interface INewsletter extends Document {
  gmailMessageId: string;
  threadId: string;
  subject: string;
  sender: string;
  snippet: string;
  bodyHtml: string;
  bodyText: string;
  labels: string[];
  isRead: boolean;
  receivedAt: Date;
}

const newsletterSchema = new Schema<INewsletter>(
  {
    gmailMessageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    threadId: {
      type: String,
      required: true,
    },
    subject: {
      type: String,
      required: true,
    },
    sender: {
      type: String,
      required: true,
    },
    snippet: {
      type: String,
      default: '',
    },
    bodyHtml: {
      type: String,
      required: true,
    },
    bodyText: {
      type: String,
      required: true,
    },
    labels: {
      type: [String],
      required: true,
      index: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    receivedAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const Newsletter = model<INewsletter>('Newsletter', newsletterSchema);
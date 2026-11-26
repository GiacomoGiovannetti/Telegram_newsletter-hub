import 'dotenv/config';
import sanitizeHtml from 'sanitize-html';
import { google, type gmail_v1 } from 'googleapis';
import { Newsletter } from '../models/newsletter.js';

const TARGET_LABELS_SEPARATOR = ',';
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'blockquote',
    'img',
    'table',
    'tr',
    'td',
    'th',
    'br',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  nonTextTags: ['script', 'style', 'iframe', 'textarea', 'option'],
  exclusiveFilter: (frame) =>
    frame.tag === 'img' &&
    frame.attribs.width === '1' &&
    frame.attribs.height === '1',
};

interface MessageContent {
  bodyHtml: string;
  bodyText: string;
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createGmailClient(): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2(
    getRequiredEnvironmentVariable('GMAIL_CLIENT_ID'),
    getRequiredEnvironmentVariable('GMAIL_CLIENT_SECRET'),
    getRequiredEnvironmentVariable('GMAIL_REDIRECT_URI'),
  );

  auth.setCredentials({
    refresh_token: getRequiredEnvironmentVariable('GMAIL_REFRESH_TOKEN'),
  });

  return google.gmail({ version: 'v1', auth });
}

function decodeBase64Url(data: string | null | undefined): string {
  if (!data) {
    return '';
  }

  const base64 = data.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);

  return Buffer.from(`${base64}${padding}`, 'base64').toString('utf8');
}

function collectMimeParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
  results: string[],
): void {
  if (!part) {
    return;
  }

  if (part.mimeType === mimeType && part.body?.data) {
    results.push(decodeBase64Url(part.body.data));
  }

  for (const childPart of part.parts ?? []) {
    collectMimeParts(childPart, mimeType, results);
  }
}

function extractMessageContent(payload: gmail_v1.Schema$MessagePart | undefined): MessageContent {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  collectMimeParts(payload, 'text/html', htmlParts);
  collectMimeParts(payload, 'text/plain', textParts);

  const sourceHtml = htmlParts.join('\n');
  const bodyText = sanitizeHtml(textParts.join('\n'), {
    allowedTags: [],
    allowedAttributes: {},
  });

  if (sourceHtml) {
    return {
      bodyHtml: sanitizeHtml(sourceHtml, SANITIZE_OPTIONS),
      bodyText: bodyText || sanitizeHtml(sourceHtml, { allowedTags: [], allowedAttributes: {} }),
    };
  }

  const escapedText = sanitizeHtml(textParts.join('\n'), {
    allowedTags: [],
    allowedAttributes: {},
  });

  return {
    bodyHtml: escapedText
      ? escapedText
          .split(/\r?\n/)
          .map((line) => `<p>${line || '<br>'}</p>`)
          .join('')
      : '',
    bodyText: escapedText,
  };
}

function getHeader(message: gmail_v1.Schema$Message, name: string): string {
  return message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value ?? '';
}

function getReceivedAt(message: gmail_v1.Schema$Message): Date {
  if (message.internalDate) {
    const timestamp = Number(message.internalDate);

    if (Number.isFinite(timestamp)) {
      return new Date(timestamp);
    }
  }

  const headerDate = getHeader(message, 'Date');
  const parsedDate = headerDate ? new Date(headerDate) : undefined;

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Cannot determine received date for Gmail message ${message.id ?? '<unknown>'}`);
  }

  return parsedDate;
}

async function listTargetLabelIds(
  gmail: gmail_v1.Gmail,
  targetLabels: string[],
): Promise<Map<string, string>> {
  const availableLabels = new Map<string, string>();
  const response = await gmail.users.labels.list({ userId: 'me' });

  for (const label of response.data.labels ?? []) {
    if (label.id && label.name) {
      availableLabels.set(label.name, label.id);
    }
  }

  const resolvedLabels = new Map<string, string>();
  const missingLabels: string[] = [];

  for (const targetLabel of targetLabels) {
    const labelId = availableLabels.get(targetLabel);

    if (labelId) {
      resolvedLabels.set(targetLabel, labelId);
    } else {
      missingLabels.push(targetLabel);
    }
  }

  if (missingLabels.length > 0) {
    throw new Error(`Gmail target labels not found: ${missingLabels.join(', ')}`);
  }

  return resolvedLabels;
}

async function listMessageIds(
  gmail: gmail_v1.Gmail,
  labelId: string,
): Promise<string[]> {
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelId],
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      if (message.id) {
        messageIds.push(message.id);
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return messageIds;
}

export async function syncNewsletters(): Promise<void> {
  const targetLabels = getRequiredEnvironmentVariable('GMAIL_TARGET_LABELS')
    .split(TARGET_LABELS_SEPARATOR)
    .map((label) => label.trim())
    .filter(Boolean);

  if (targetLabels.length === 0) {
    throw new Error('GMAIL_TARGET_LABELS must contain at least one label');
  }

  const gmail = createGmailClient();
  const targetLabelIds = await listTargetLabelIds(gmail, targetLabels);
  const labelsByMessageId = new Map<string, Set<string>>();

  for (const [labelName, labelId] of targetLabelIds) {
    for (const messageId of await listMessageIds(gmail, labelId)) {
      const labels = labelsByMessageId.get(messageId) ?? new Set<string>();
      labels.add(labelName);
      labelsByMessageId.set(messageId, labels);
    }
  }

  const messageIds = [...labelsByMessageId.keys()];
  const existingNewsletters = await Newsletter.find({
    gmailMessageId: { $in: messageIds },
  })
    .select({ gmailMessageId: 1 })
    .lean();
  const existingMessageIds = new Set(
    existingNewsletters.map((newsletter) => newsletter.gmailMessageId),
  );

  for (const gmailMessageId of messageIds) {
    if (existingMessageIds.has(gmailMessageId)) {
      continue;
    }

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'full',
    });
    const message = response.data;
    const content = extractMessageContent(message.payload);

    await Newsletter.updateOne(
      { gmailMessageId },
      {
        $setOnInsert: {
          gmailMessageId,
          threadId: message.threadId ?? '',
          subject: getHeader(message, 'Subject'),
          sender: getHeader(message, 'From'),
          snippet: message.snippet ?? '',
          bodyHtml: content.bodyHtml,
          bodyText: content.bodyText,
          labels: [...(labelsByMessageId.get(gmailMessageId) ?? [])],
          isRead: !message.labelIds?.includes('UNREAD'),
          receivedAt: getReceivedAt(message),
        },
      },
      { upsert: true },
    );
  }
}

export async function markEmailAsReadInGmail(gmailMessageId: string): Promise<void> {
  const gmail = createGmailClient();

  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}
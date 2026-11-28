import 'dotenv/config';
import crypto from 'node:crypto';
import cors from 'cors';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { isValidObjectId } from 'mongoose';
import { Newsletter } from '../models/newsletter.js';
import { markEmailAsReadInGmail } from '../services/gmailService.js';

const router = Router();
const webAppUrl = process.env.WEBAPP_URL;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const allowedCorsOrigins = (webAppUrl ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

function validateTelegramInitData(initData: string): boolean {
  if (!botToken) {
    return false;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    return false;
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const hashBuffer = Buffer.from(hash, 'hex');
  const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

  if (
    hashBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)
  ) {
    return false;
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) {
    return false;
  }

  const maxAgeSeconds = 24 * 60 * 60;
  if (Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) {
    return false;
  }

  const allowedUserId = Number(process.env.ALLOWED_TELEGRAM_USER_ID);
  if (!Number.isFinite(allowedUserId)) {
    return false;
  }

  try {
    const telegramUser = JSON.parse(params.get('user') ?? '{}') as {
      id?: number;
    };
    return telegramUser.id === allowedUserId;
  } catch {
    return false;
  }
}

router.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedCorsOrigins.length === 0) {
        callback(null, true);
        return;
      }

      callback(null, allowedCorsOrigins.includes(origin));
    },
    methods: ['GET', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-telegram-init-data'],
    optionsSuccessStatus: 204,
  }),
);

router.use((request: Request, response: Response, next: NextFunction) => {
  const initData = request.get('x-telegram-init-data');

  if (!initData || !validateTelegramInitData(initData)) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
});

router.get('/newsletters', async (request, response) => {
  const label =
    typeof request.query.label === 'string' ? request.query.label.trim() : '';
  const sort =
    typeof request.query.sort === 'string' ? request.query.sort : 'latest';
  const unreadOnly = request.query.unreadOnly === 'true';

  if (!['latest', 'oldest', 'random'].includes(sort)) {
    response.status(400).json({ error: 'Invalid sort value' });
    return;
  }

  const filter: Record<string, unknown> = {};

  if (label) {
    filter.labels = label;
  }

  if (unreadOnly) {
    filter.isRead = false;
  }

  if (sort === 'random') {
    const count = await Newsletter.countDocuments(filter);

    if (count === 0) {
      response.json([]);
      return;
    }

    const newsletters = await Newsletter.aggregate([
      { $match: filter },
      { $sample: { size: count } },
      { $project: { bodyHtml: 0 } },
    ]);

    response.json(newsletters);
    return;
  }

  const newsletters = await Newsletter.find(filter)
    .select('-bodyHtml')
    .sort({ receivedAt: sort === 'oldest' ? 1 : -1 });

  response.json(newsletters);
});

router.get('/newsletters/:id', async (request, response) => {
  if (!isValidObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid newsletter id' });
    return;
  }

  const newsletter = await Newsletter.findById(request.params.id);

  if (!newsletter) {
    response.status(404).json({ error: 'Newsletter not found' });
    return;
  }

  response.json(newsletter);
});

router.patch('/newsletters/:id/read', async (request, response) => {
  if (!isValidObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid newsletter id' });
    return;
  }

  const newsletter = await Newsletter.findByIdAndUpdate(
    request.params.id,
    { isRead: true },
    { new: true },
  );

  if (!newsletter) {
    response.status(404).json({ error: 'Newsletter not found' });
    return;
  }

  await markEmailAsReadInGmail(newsletter.gmailMessageId);
  response.json(newsletter);
});

export default router;
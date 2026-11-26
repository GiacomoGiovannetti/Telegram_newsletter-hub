import 'dotenv/config';
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

router.use(
  cors({
    origin: webAppUrl,
    methods: ['GET', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-secret'],
  }),
);

router.use((request: Request, response: Response, next: NextFunction) => {
  const apiSecret = process.env.API_SECRET ?? process.env.TELEGRAM_BOT_TOKEN;

  if (!apiSecret) {
    response.status(503).json({ error: 'API authentication is not configured' });
    return;
  }

  if (request.get('x-api-secret') !== apiSecret) {
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
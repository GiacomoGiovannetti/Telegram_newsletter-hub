import 'dotenv/config';
import { Markup, Telegraf, type Context } from 'telegraf';
import { Newsletter, type INewsletter } from '../models/newsletter.js';
import {
  markEmailAsReadInGmail,
  syncNewsletters,
} from '../services/gmailService.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const allowedUserId = Number(process.env.ALLOWED_TELEGRAM_USER_ID);
const webAppUrl = process.env.WEBAPP_URL!;

bot.use(async (ctx, next) => {
  if (ctx.from?.id !== allowedUserId) {
    return;
  }

  await next();
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatNewsletter(newsletter: INewsletter): string {
  const snippet = Array.from(newsletter.snippet).slice(0, 300).join('');
  const labels = newsletter.labels.join(', ');
  const receivedAt = newsletter.receivedAt.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return [
    `<b>Oggetto: ${escapeHtml(newsletter.subject)}</b>`,
    `<b>Mittente:</b> ${escapeHtml(newsletter.sender)}`,
    `<b>Data:</b> ${receivedAt}`,
    `<b>Etichetta:</b> ${escapeHtml(labels)}`,
    '',
    escapeHtml(snippet),
  ].join('\n');
}

function newsletterKeyboard(newsletter: INewsletter) {
  return Markup.inlineKeyboard([
    [
      Markup.button.webApp(
        'Leggi nella Web App',
        `${webAppUrl}?id=${newsletter._id.toString()}`,
      ),
    ],
    [
      Markup.button.callback(
        'Segna come letta',
        `read:${newsletter._id.toString()}`,
      ),
    ],
  ]);
}

async function sendNewsletter(
  ctx: Context,
  newsletter: INewsletter | null,
): Promise<void> {
  await ctx.answerCbQuery();

  if (!newsletter) {
    await ctx.reply('Nessuna newsletter non letta trovata.');
    return;
  }

  await ctx.reply(formatNewsletter(newsletter), {
    parse_mode: 'HTML',
    ...newsletterKeyboard(newsletter),
  });
}

bot.start(async (ctx) => {
  await ctx.reply(
    'Benvenuto nel Newsletter Hub! Scegli un’azione:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Ultima Newsletter', 'fetch:latest')],
      [Markup.button.callback('Meno Recente', 'fetch:oldest')],
      [Markup.button.callback('Casuale', 'fetch:random')],
      [Markup.button.callback('Filtra per Etichetta', 'menu:labels')],
      [Markup.button.webApp('Apri Web App Hub', webAppUrl)],
      [Markup.button.callback('Sincronizza Ora', 'action:sync')],
    ]),
  );
});

bot.action('menu:labels', async (ctx) => {
  const labels = (await Newsletter.distinct('labels', { isRead: false })).filter(
    (label): label is string => typeof label === 'string',
  );
  await ctx.answerCbQuery();

  if (labels.length === 0) {
    await ctx.reply('Nessuna etichetta con newsletter non lette.');
    return;
  }

  await ctx.reply(
    'Scegli un’etichetta:',
    Markup.inlineKeyboard(
      labels
        .sort((left, right) => left.localeCompare(right))
        .map((label) => [
          Markup.button.callback(label, `label:${encodeURIComponent(label)}`),
        ]),
    ),
  );
});

bot.action('fetch:latest', async (ctx) => {
  const newsletter = await Newsletter.findOne({ isRead: false }).sort({
    receivedAt: -1,
  });

  await sendNewsletter(ctx, newsletter);
});

bot.action('fetch:oldest', async (ctx) => {
  const newsletter = await Newsletter.findOne({ isRead: false }).sort({
    receivedAt: 1,
  });

  await sendNewsletter(ctx, newsletter);
});

bot.action('fetch:random', async (ctx) => {
  const [newsletter] = await Newsletter.aggregate<INewsletter>([
    { $match: { isRead: false } },
    { $sample: { size: 1 } },
  ]);

  await sendNewsletter(ctx, newsletter ?? null);
});

bot.action(/^label:(.+)$/, async (ctx) => {
  const label = decodeURIComponent(ctx.match[1]);
  const newsletter = await Newsletter.findOne({
    isRead: false,
    labels: label,
  }).sort({ receivedAt: -1 });

  await sendNewsletter(ctx, newsletter);
});

bot.action('action:sync', async (ctx) => {
  await ctx.answerCbQuery('Sincronizzazione avviata');
  await syncNewsletters();
  await ctx.reply('Sincronizzazione completata.');
});

bot.action(/^read:(.+)$/, async (ctx) => {
  const newsletter = await Newsletter.findByIdAndUpdate(
    ctx.match[1],
    { isRead: true },
    { new: true },
  );

  await ctx.answerCbQuery();

  if (!newsletter) {
    await ctx.reply('Newsletter non trovata.');
    return;
  }

  await markEmailAsReadInGmail(newsletter.gmailMessageId);
  await ctx.editMessageText(
    'Newsletter archiviata e segnata come letta su Gmail.',
  );
});

export default bot;
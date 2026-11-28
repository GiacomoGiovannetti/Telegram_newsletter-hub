import 'dotenv/config';
import mongoose from 'mongoose';
import cron, { type ScheduledTask } from 'node-cron';
import app from './app.js';
import bot from './bot/telegramBot.js';
import { syncNewsletters } from './services/gmailService.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
//declaring in a shorter way env vars
const envVars = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  cluster: process.env.DB_CLUSTER,
  dbName: process.env.DB_NAME,
};
const dbURI = `mongodb+srv://${envVars.user}:${envVars.password}@${envVars.cluster}.${envVars.dbName}/`;
let task: ScheduledTask | undefined;
let server: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;

if (!dbURI) {
  throw new Error(
    'Missing required environment variable: DB_USER, DB_PASSWORD, DB_CLUSTER, or DB_NAME',
  );
}

function isTelegramConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('409: Conflict');
}

async function launchBotWithRetry(): Promise<void> {
  const maxAttempts = 12;
  const retryDelayMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await bot.launch();
      console.log('Telegram bot started');
      return;
    } catch (error: unknown) {
      if (!isTelegramConflictError(error) || attempt === maxAttempts) {
        throw error;
      }

      console.warn(
        `Telegram getUpdates conflict (attempt ${attempt}/${maxAttempts}). Retrying in ${retryDelayMs}ms...`,
      );

      await new Promise<void>((resolve) => {
        setTimeout(resolve, retryDelayMs);
      });
    }
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down...`);
  task?.stop();
  bot.stop(signal);

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await mongoose.disconnect();
}

async function start(): Promise<void> {
  await mongoose.connect(dbURI);

  server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  task = cron.schedule('*/30 * * * *', () => {
    void syncNewsletters().catch((error: unknown) => {
      console.error('Scheduled newsletter synchronization failed:', error);
    });
  });

  await launchBotWithRetry();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').catch((error: unknown) => {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  });
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM').catch((error: unknown) => {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  });
});

void start().catch((error: unknown) => {
  console.error('Application startup failed:', error);
  process.exitCode = 1;
});

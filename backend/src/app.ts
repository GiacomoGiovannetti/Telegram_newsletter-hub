import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import newsletterRoutes from './routes/newsletterRoutes.js';

const app = express();

app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org', "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        connectSrc: ["'self'", process.env.WEBAPP_URL ?? ''],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  }),
);
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_request, response) => {
  response.status(200).send('OK');
});

app.use('/api', newsletterRoutes);

export default app;

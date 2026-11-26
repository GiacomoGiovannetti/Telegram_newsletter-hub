import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import newsletterRoutes from './routes/newsletterRoutes.js';

const app = express();

app.use(helmet());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.status(200).send('OK');
});

app.use('/api', newsletterRoutes);

export default app;

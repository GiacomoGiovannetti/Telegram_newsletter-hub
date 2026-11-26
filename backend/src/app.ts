import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';

const app = express();

app.use(helmet());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

export default app;

import dotenv from 'dotenv';
import app from './app.js';
import { db, dbConnection } from './config/db.js';

dotenv.config();

const port = process.env.PORT || 3000;

dbConnection();

db.once('connected', () => {
  app.listen(port, () => {
    console.log(`Server is listening at ${port}`);
  });
});

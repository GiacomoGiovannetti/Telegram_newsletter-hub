import "dotenv/config";
import express from "express";
import helmet from "helmet";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

app.use(helmet());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

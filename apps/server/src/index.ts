import { SERVER_PORT } from "./config.js";
import { createServer } from "./api.js";

const app = await createServer();

app.listen({ port: SERVER_PORT, host: "0.0.0.0" }).catch((error) => {
  console.error(error);
  process.exit(1);
});

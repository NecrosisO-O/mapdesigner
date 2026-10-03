import { SERVER_PORT, SERVER_HOST, validateListenConfig } from "./config.js";
import { createServer } from "./api.js";

validateListenConfig();
const app = await createServer();

app.listen({ port: SERVER_PORT, host: SERVER_HOST }).catch((error) => {
  console.error(error);
  process.exit(1);
});

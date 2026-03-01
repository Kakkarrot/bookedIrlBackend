import { buildServer } from "./server";
import { env } from "./config/env";

async function start() {
  const app = buildServer();
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

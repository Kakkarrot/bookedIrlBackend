import { FastifyInstance } from "fastify";
import { headlineOptions } from "../config/headlines";

export async function headlineRoutes(app: FastifyInstance) {
  app.get("/headlines", async () => {
    return { headlines: headlineOptions };
  });
}

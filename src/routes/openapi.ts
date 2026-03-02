import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

export async function openapiRoutes(app: FastifyInstance) {
  app.get("/openapi.yaml", async (_request, reply) => {
    const specPath = path.resolve(process.cwd(), "openapi.yaml");
    const spec = fs.readFileSync(specPath, "utf8");
    reply.type("application/yaml").send(spec);
  });
}

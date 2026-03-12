import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireUser } from "../lib/auth";
import { storageClient, storageBucket } from "../lib/storage";

const allowedContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

const signSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentType: z.string().min(1)
      })
    )
    .min(1)
    .max(6)
});

const deleteSchema = z.object({
  paths: z.array(z.string().min(1)).max(6).optional(),
  urls: z.array(z.string().url()).max(6).optional()
});

function sanitizeFilename(filename: string) {
  const lastDot = filename.lastIndexOf(".");
  const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot > 0 ? filename.slice(lastDot) : "";
  const safeBase = base.replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase().slice(0, 48);
  return `${safeBase || "photo"}${ext}`;
}

function pathFromUrl(url: string) {
  const marker = `/storage/v1/object/public/${storageBucket}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return url.slice(index + marker.length);
}

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/uploads/photos/sign", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = signSchema.parse(request.body);

    const uploads = await Promise.all(
      payload.files.map(async (file) => {
        if (!allowedContentTypes.has(file.contentType)) {
          reply.code(400);
          throw new Error("invalid_content_type");
        }

        const safeName = sanitizeFilename(file.filename);
        const path = `users/${auth.userId}/${randomUUID()}-${safeName}`;
        const { data, error } = await storageClient
          .storage
          .from(storageBucket)
          .createSignedUploadUrl(path);

        if (error || !data) {
          reply.code(500);
          throw new Error("upload_url_failed");
        }

        const publicUrl = storageClient.storage.from(storageBucket).getPublicUrl(path).data.publicUrl;
        return {
          path,
          uploadUrl: data.signedUrl,
          publicUrl
        };
      })
    );

    reply.send({ uploads });
  });

  app.post("/uploads/photos/delete", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = deleteSchema.parse(request.body);
    const paths: string[] =
      payload.paths ??
      payload.urls
        ?.map(pathFromUrl)
        .filter((path): path is string => Boolean(path)) ??
      [];

    if (!paths.length) {
      reply.code(400).send({ error: "no_paths_provided" });
      return;
    }

    const safePaths = paths.filter((path) => path.startsWith(`users/${auth.userId}/`));
    if (!safePaths.length) {
      reply.code(403).send({ error: "invalid_paths" });
      return;
    }

    const { error } = await storageClient.storage.from(storageBucket).remove(safePaths);
    if (error) {
      reply.code(500).send({ error: "delete_failed" });
      return;
    }

    reply.send({ ok: true });
  });
}

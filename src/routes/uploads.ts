import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireUser } from "../lib/auth";
import { logRequestEvent } from "../lib/logging";
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
    .max(3)
});

const deleteSchema = z.object({
  paths: z.array(z.string().min(1)).max(3).optional(),
  urls: z.array(z.string().url()).max(3).optional()
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
          logRequestEvent(request, "warn", "photo_upload_sign_rejected", {
            reason: "invalid_content_type",
            actor_user_id: auth.userId,
            content_type: file.contentType
          });
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
          logRequestEvent(request, "error", "photo_upload_sign_failed", {
            actor_user_id: auth.userId,
            storage_error: error?.message ?? "unknown"
          });
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

    logRequestEvent(request, "info", "photo_upload_urls_created", {
      actor_user_id: auth.userId,
      file_count: uploads.length
    });
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
      logRequestEvent(request, "warn", "photo_delete_rejected", {
        reason: "no_paths_provided",
        actor_user_id: auth.userId
      });
      reply.code(400).send({ error: "no_paths_provided" });
      return;
    }

    const safePaths = paths.filter((path) => path.startsWith(`users/${auth.userId}/`));
    if (!safePaths.length) {
      logRequestEvent(request, "warn", "photo_delete_rejected", {
        reason: "invalid_paths",
        actor_user_id: auth.userId
      });
      reply.code(403).send({ error: "invalid_paths" });
      return;
    }

    const { error } = await storageClient.storage.from(storageBucket).remove(safePaths);
    if (error) {
      logRequestEvent(request, "error", "photo_delete_failed", {
        actor_user_id: auth.userId,
        file_count: safePaths.length,
        storage_error: error.message
      });
      reply.code(500).send({ error: "delete_failed" });
      return;
    }

    logRequestEvent(request, "info", "photo_deleted", {
      actor_user_id: auth.userId,
      file_count: safePaths.length
    });
    reply.send({ ok: true });
  });
}

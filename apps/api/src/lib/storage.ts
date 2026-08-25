import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Response } from "express";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../env";
import { HttpError } from "./http";
import { UPLOADS_DIR, PUBLIC_UPLOADS_DIR } from "./uploads";

// Media storage. Cloudinary when CLOUDINARY_* is configured; local disk under
// apps/api/uploads/ otherwise (dev fallback, same philosophy as SMTP/Paypack).
//
// Two visibilities:
//   private — KYC documents (IDs, licences, RDB certificates). Uploaded as
//             *authenticated* Cloudinary assets and only ever delivered through
//             our own authorised GET /documents/:id, which fetches them
//             server-side; no URL that resolves without our access check ever
//             reaches a client.
//   public  — profile pictures. Served straight from Cloudinary's CDN with an
//             on-the-fly face-centred square crop.
//
// Storage keys (Document.filePath / User.avatarKey):
//   cld:<type>:<resource_type>:<public_id>   Cloudinary asset
//   local:<filename>                          private file under uploads/
//   local-public:<filename>                   public file under uploads/public/
//   <filename>                                legacy rows: same as local:<filename>

export const cloudinaryEnabled =
  env.cloudinaryCloudName.length > 0 && env.cloudinaryApiKey.length > 0 && env.cloudinaryApiSecret.length > 0;

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
}

export type Visibility = "private" | "public";
export interface UploadInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export function fromMulter(f: Express.Multer.File): UploadInput {
  return { buffer: f.buffer, mimeType: f.mimetype, originalName: f.originalname };
}

type CloudType = "upload" | "authenticated";
type CloudResource = "image" | "raw";
type ParsedKey =
  | { kind: "cloudinary"; type: CloudType; resourceType: CloudResource; publicId: string }
  | { kind: "local"; publicFile: boolean; name: string };

function parseKey(key: string): ParsedKey {
  if (key.startsWith("cld:")) {
    const [, type, resourceType, ...rest] = key.split(":");
    return { kind: "cloudinary", type: type as CloudType, resourceType: resourceType as CloudResource, publicId: rest.join(":") };
  }
  if (key.startsWith("local-public:")) return { kind: "local", publicFile: true, name: key.slice("local-public:".length) };
  if (key.startsWith("local:")) return { kind: "local", publicFile: false, name: key.slice("local:".length) };
  return { kind: "local", publicFile: false, name: key };
}

// Resolve a local key to a path, refusing anything that escapes its directory.
function localPath(p: { publicFile: boolean; name: string }): string {
  const dir = p.publicFile ? PUBLIC_UPLOADS_DIR : UPLOADS_DIR;
  const full = path.resolve(dir, p.name);
  if (!full.startsWith(dir + path.sep)) throw new HttpError(400, "Invalid file key");
  return full;
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// Upload a file and return its storage key.
export async function storeFile(input: UploadInput, opts: { folder: string; visibility: Visibility }): Promise<string> {
  if (cloudinaryEnabled) {
    // Images get Cloudinary's image pipeline (needed for the avatar crop);
    // PDFs are stored byte-for-byte as raw assets.
    const resourceType: CloudResource = input.mimeType.startsWith("image/") ? "image" : "raw";
    const type: CloudType = opts.visibility === "private" ? "authenticated" : "upload";
    const result = await new Promise<{ public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `relay/${opts.folder}`, resource_type: resourceType, type, use_filename: false, unique_filename: true, overwrite: false },
        (err, res) => (err || !res ? reject(err ?? new Error("Cloudinary returned no result")) : resolve(res))
      );
      stream.end(input.buffer);
    }).catch((e: unknown) => {
      // Cloudinary rejects corrupt/unsupported files with an http_code: that is
      // the uploaded file at fault, not an outage, so answer 400 rather than 500.
      const code = (e as { http_code?: number })?.http_code;
      if (code && code >= 400 && code < 500) throw new HttpError(400, "That file could not be processed — upload a valid PDF, JPEG, PNG or WebP");
      throw e;
    });
    return `cld:${type}:${resourceType}:${result.public_id}`;
  }

  const name = `${crypto.randomBytes(16).toString("hex")}${EXT_BY_MIME[input.mimeType] ?? path.extname(input.originalName).toLowerCase()}`;
  const publicFile = opts.visibility === "public";
  await fs.promises.writeFile(localPath({ publicFile, name }), input.buffer);
  return `${publicFile ? "local-public" : "local"}:${name}`;
}

// Delete a stored file. Best-effort by design: callers invoke this after the
// database change that made the file unreferenced has committed, so an
// orphaned file is the worst case — never a failed request.
export async function deleteFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    const p = parseKey(key);
    if (p.kind === "cloudinary") {
      await cloudinary.uploader.destroy(p.publicId, { resource_type: p.resourceType, type: p.type, invalidate: true });
    } else {
      await fs.promises.unlink(localPath(p)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  } catch (e) {
    console.error(`[storage] failed to delete ${key}:`, e);
  }
}

// Stream a private file to the response. Access control is the caller's job.
export async function sendStoredFile(key: string, res: Response, meta: { fileName: string; mimeType: string }): Promise<void> {
  res.setHeader("Content-Type", meta.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${meta.fileName.replace(/"/g, "")}"`);
  const p = parseKey(key);
  if (p.kind === "local") {
    res.sendFile(localPath(p));
    return;
  }
  // Signed URL for the authenticated asset, fetched here and relayed — the
  // signed URL itself is never handed to the client.
  const url = cloudinary.url(p.publicId, { resource_type: p.resourceType, type: p.type, sign_url: true, secure: true });
  const r = await fetch(url);
  if (!r.ok) throw new HttpError(502, `Could not fetch the document from storage (${r.status})`);
  res.end(Buffer.from(await r.arrayBuffer()));
}

// URL a browser can load directly (public files only — profile pictures).
export function publicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const p = parseKey(key);
  if (p.kind === "cloudinary") {
    return cloudinary.url(p.publicId, {
      resource_type: p.resourceType,
      type: p.type,
      secure: true,
      transformation: [{ width: 256, height: 256, crop: "fill", gravity: "face" }, { fetch_format: "auto", quality: "auto" }],
    });
  }
  return `${env.apiPublicUrl}/public/${encodeURIComponent(p.name)}`;
}

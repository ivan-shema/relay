import fs from "fs";
import path from "path";
import multer from "multer";
import { HttpError } from "./http";

// Upload parsing (multer, in memory) for KYC documents and profile pictures.
// Where the bytes end up — Cloudinary or local disk — is lib/storage.ts's job.
// KYC files contain PII: they are served ONLY through the authenticated
// GET /documents/:id route, never from a public URL.

export const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
export const PUBLIC_UPLOADS_DIR = path.join(UPLOADS_DIR, "public");
for (const dir of [UPLOADS_DIR, PUBLIC_UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// PDF and images only — explicitly no GIFs.
const DOCUMENT_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function onlyMime(allowed: Set<string>, message: string): multer.Options["fileFilter"] {
  return (_req, file, cb) => (allowed.has(file.mimetype) ? cb(null, true) : cb(new HttpError(400, message)));
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
  fileFilter: onlyMime(DOCUMENT_MIME, "Only PDF, JPEG, PNG or WebP files are allowed"),
});

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: onlyMime(IMAGE_MIME, "Profile pictures must be JPEG, PNG or WebP"),
});

// Pull a single named file out of a multer.fields() request, or throw 400.
export function requireFile(req: { files?: unknown }, name: string): Express.Multer.File {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const f = files?.[name]?.[0];
  if (!f) throw new HttpError(400, `Missing required document: ${name}`);
  return f;
}

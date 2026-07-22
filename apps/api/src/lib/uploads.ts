import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { HttpError } from "./http";

// KYC document uploads (ID / passport / driving licence / RDB business
// certificate). Stored on local disk for dev — in production move to private
// object storage with signed URLs. Served ONLY via the authenticated
// GET /documents/:id route (never statically): these files contain PII.

export const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// PDF and images only — explicitly no GIFs.
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new HttpError(400, "Only PDF, JPEG, PNG or WebP files are allowed"));
    }
    cb(null, true);
  },
});

// Pull a single named file out of a multer.fields() request, or throw 400.
export function requireFile(req: { files?: unknown }, name: string): Express.Multer.File {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const f = files?.[name]?.[0];
  if (!f) throw new HttpError(400, `Missing required document: ${name}`);
  return f;
}

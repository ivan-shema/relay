import { Router } from "express";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import { sendStoredFile } from "../lib/storage";

export const documentsRouter = Router();

// GET /documents/:id — download a KYC document. These contain PII, so access
// is restricted to: platform admins, the operator that owns the document, or
// the operator that the document's driver belongs to.
documentsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { operator: true, driver: { include: { operator: true } }, invite: { include: { operator: true } } },
    });
    if (!doc) throw new HttpError(404, "Document not found");

    const sub = req.auth!.sub;
    const isAdmin = req.auth!.role === "ADMIN";
    const ownsOperatorDoc = doc.operator?.ownerUserId === sub;
    const ownsDriverDoc = doc.driver?.operator?.ownerUserId === sub;
    const isDriverSelf = doc.driver?.userId === sub;
    // KYC a driver candidate uploaded: the inviting operator reviews it, and
    // the candidate can see their own upload.
    const ownsInviteDoc = doc.invite?.operator.ownerUserId === sub;
    const isInvitee = doc.invite?.userId === sub;
    if (!isAdmin && !ownsOperatorDoc && !ownsDriverDoc && !isDriverSelf && !ownsInviteDoc && !isInvitee) {
      throw new HttpError(403, "You don't have access to this document");
    }

    await sendStoredFile(doc.filePath, res, { fileName: doc.fileName, mimeType: doc.mimeType });
  })
);

import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@relay/shared";
import { HttpError } from "../lib/http";
import { verifyAccessToken, type TokenPayload } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Authentication required");
  }
  try {
    req.auth = verifyAccessToken(header.slice(7));
    next();
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw new HttpError(401, "Authentication required");
    if (!roles.includes(req.auth.role)) {
      throw new HttpError(403, "Insufficient permissions");
    }
    next();
  };
}

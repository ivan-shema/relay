import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@relay/shared";
import { HttpError } from "../lib/http";
import { prisma } from "../prisma";
import { verifyAccessToken, type TokenPayload } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

// Verifies the bearer token AND that its user still exists. A signed token
// alone is not enough: after a reseed, an account deletion, or a token minted
// against another environment with the same secret, the id in the token has no
// row behind it and every write that references it would die with an FK
// violation (500). The role is taken from the database, not the token, so an
// admin promoting a passenger to operator takes effect on their next request
// instead of waiting for a token refresh.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Authentication required");
  }
  let payload: TokenPayload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  prisma.user
    .findUnique({ where: { id: payload.sub }, select: { id: true, role: true } })
    .then((user) => {
      if (!user) throw new HttpError(401, "Your session is no longer valid — please sign in again");
      req.auth = { sub: user.id, role: user.role };
      next();
    })
    .catch(next);
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

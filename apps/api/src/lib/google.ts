import { OAuth2Client } from "google-auth-library";
import { env } from "../env";
import { HttpError } from "./http";

export interface GoogleIdentity {
  sub: string; // stable Google account id — what we key User.googleId on
  email: string;
  firstName: string;
  lastName: string;
  picture?: string; // Google profile photo URL, if the account has one
}

const client = new OAuth2Client(env.googleClientId || undefined);

// Verifies a Google Identity Services ID token (signature against Google's
// published keys, expiry, and that it was minted for OUR client id) and
// returns the bits accounts are keyed on. Only verified emails are accepted —
// otherwise anyone could claim an existing account's address.
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  if (!env.googleClientId) throw new HttpError(503, "Google sign-in is not configured");

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, "Google sign-in failed — please try again");
  }
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw new HttpError(401, "Your Google account has no verified email address");
  }

  // Google sends given/family names separately; fall back to splitting the
  // display name so the completion form is pre-filled either way.
  const [first = "", ...rest] = (payload.name ?? "").trim().split(/\s+/);
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    firstName: payload.given_name ?? first,
    lastName: payload.family_name ?? rest.join(" "),
    picture: payload.picture,
  };
}

import { z } from "zod";

// Single source of truth for form/request validation — used by the API
// (server-side) and the web forms (react-hook-form via zodResolver).
// Numeric fields use z.coerce so the same schema accepts form strings and
// JSON numbers.

export const roleEnum = z.enum(["PASSENGER", "DRIVER", "OPERATOR", "ADMIN"]);
export const modeEnum = z.enum(["BUS", "MOTO", "RIDE"]);
export const paymentMethodEnum = z.enum(["MOBILE_MONEY", "WALLET", "QR"]);

/* ---------------- Phone numbers (Rwanda) ---------------- */
// Rwandan mobile numbers only — MTN (078/079) and Airtel (072/073). Users may
// type either the international form (+250 7XX XXX XXX, 12 chars) or the local
// form (07XX XXX XXX, 10 digits); spaces, dashes, dots and parentheses are
// tolerated and stripped. Everything is STORED in the canonical +2507XXXXXXXX
// form so lookups (login by phone, uniqueness) match regardless of how the
// number was typed.
export const rwandaPhoneRegex = /^(\+250|0)7[2389]\d{7}$/;
export const PHONE_ERROR = "Enter a Rwandan mobile number: +2507XXXXXXXX or 07XXXXXXXX";

export function normalizeRwandaPhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s\-().]/g, "");
  if (!rwandaPhoneRegex.test(compact)) return null;
  return "+250" + compact.slice(-9);
}

// Validates + normalizes in one step; the parsed value is always canonical.
export const phoneSchema = z.string().transform((v, ctx) => {
  const n = normalizeRwandaPhone(v);
  if (!n) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_ERROR });
    return z.NEVER;
  }
  return n;
});

// "Phone or email" fields: a valid email passes through, a phone is normalized.
const emailSchema = z.string().trim().email();
export const phoneOrEmailSchema = z.string().transform((v, ctx) => {
  const e = emailSchema.safeParse(v);
  if (e.success) return e.data;
  const n = normalizeRwandaPhone(v);
  if (!n) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid email or Rwandan mobile number" });
    return z.NEVER;
  }
  return n;
});

/* ---------------- Auth ---------------- */
export const loginSchema = z.object({
  identifier: z.string().min(3, "Enter your email or phone"),
  password: z.string().min(1, "Password is required"),
});

// Public registration is passenger-only — no role field. Drivers are onboarded
// by operator invite; operators go through the vetted apply flow below.
export const registerSchema = z.object({
  firstName: z.string().min(2, "Enter your first name"),
  lastName: z.string().min(2, "Enter your last name"),
  email: z.string().email("Enter a valid email"),
  phone: phoneSchema,
  password: z.string().min(8, "At least 8 characters"),
});

/* ---------------- Google sign-in ---------------- */
// `credential` is the ID token Google Identity Services hands the browser.
export const googleSignInSchema = z.object({
  credential: z.string().min(20, "Missing Google credential"),
});

// First-time Google users still need a Rwandan phone (wallet, OTP, driver
// contact), collected on a follow-up screen. Names are pre-filled from Google
// but editable. The form schema is reused by the web client.
export const googleProfileSchema = z.object({
  firstName: z.string().min(2, "Enter your first name"),
  lastName: z.string().min(2, "Enter your last name"),
  phone: phoneSchema,
});
export const googleCompleteSchema = googleProfileSchema.merge(googleSignInSchema);

// Normalizes FormData's string-or-array into TransportMode[] (multipart bodies
// deliver repeated fields as string | string[]).
const modesField = z
  .union([modeEnum, z.array(modeEnum)])
  .transform((m) => (Array.isArray(m) ? m : [m]))
  .pipe(z.array(modeEnum).min(1, "Select at least one mode"));

// Operator onboarding — submitted by an already-authenticated passenger from
// their dashboard. Creates a PENDING company that an admin must approve; the
// user stays a PASSENGER until approval. Account fields are NOT collected here
// (the user already exists). The ID document + RDB business certificate files
// are validated server-side (PDF/JPEG/PNG/WebP, no GIFs).
export const operatorOnboardingSchema = z.object({
  companyName: z.string().min(2, "Enter your company name"),
  contactInfo: phoneOrEmailSchema,
  idNumber: z.string().min(5, "Enter your ID or passport number"),
  modes: modesField,
});

export const forgotSchema = z.object({
  identifier: z.string().min(3, "Enter your email or phone"),
});

// server bodies (include ids the client attaches from state)
export const verifyOtpSchema = z.object({
  userId: z.string(),
  code: z.string().min(4, "Enter the code"),
});
export const resetSchema = z.object({
  userId: z.string(),
  code: z.string().min(4, "Enter the code"),
  password: z.string().min(8, "At least 8 characters"),
});

// client-only forms
export const otpFormSchema = z.object({
  code: z.string().min(6, "Enter the 6-digit code").max(6, "6 digits"),
});
export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });

/* ---------------- Operator / Admin creates ---------------- */
// Moto-taxis in Rwanda carry exactly one passenger — capacity above 1 is
// physically impossible, so both the vehicle and its departures reject it.
const MOTO_CAPACITY_MSG = "A moto-taxi carries one passenger — capacity must be 1";

export const createVehicleSchema = z
  .object({
    plateNumber: z.string().min(3, "Enter a plate number"),
    type: modeEnum,
    capacity: z.coerce.number({ invalid_type_error: "Enter a number" }).int("Whole number").min(1, "At least 1"),
    model: z.string().optional().default("—"),
    label: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.type === "MOTO" && d.capacity !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capacity"], message: MOTO_CAPACITY_MSG });
    }
  });

// Driver onboarding: the operator only needs the person (a registered user
// picked from search, or an email). The invitee submits their own KYC; the
// operator's approval creates the Driver record and promotes the user.
export const driverInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  note: z.string().trim().max(300, "Keep the note under 300 characters").optional(),
});
export const driverKycSchema = z.object({
  licenseNumber: z.string().trim().min(4, "Enter your driving licence number"),
  idNumber: z.string().trim().min(5, "Enter your national ID number"),
});
export const rejectDriverInviteSchema = z.object({
  reason: z.string().trim().min(10, "Tell the candidate what to fix (at least 10 characters)").max(1000),
});

export const createUserSchema = z
  .object({
    firstName: z.string().min(2, "Enter a first name"),
    lastName: z.string().min(2, "Enter a last name"),
    phone: phoneSchema,
    email: z.string().email("Enter a valid email"),
    role: roleEnum.default("PASSENGER"),
    // Required when role === OPERATOR (admin-created operators are VERIFIED
    // immediately, but still need a real company record).
    companyName: z.string().optional(),
    modes: z.union([modeEnum, z.array(modeEnum)]).optional(),
  })
  .transform((d) => ({
    ...d,
    modes: d.modes === undefined ? undefined : Array.isArray(d.modes) ? d.modes : [d.modes],
  }))
  .superRefine((d, ctx) => {
    if (d.role === "OPERATOR") {
      if (!d.companyName || d.companyName.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "Company name is required for operators" });
      }
      if (!d.modes || d.modes.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["modes"], message: "Select at least one mode" });
      }
    }
  });

// Free-text place names: pick an existing stop from the suggestions or type a
// new one — the server finds-or-creates the Place either way.
export const createRouteSchema = z
  .object({
    origin: z.string().trim().min(2, "Enter an origin"),
    destination: z.string().trim().min(2, "Enter a destination"),
    distanceKm: z.coerce.number({ invalid_type_error: "Enter a number" }).positive("Must be greater than 0").default(5),
  })
  .refine((d) => d.origin.trim().toLowerCase() !== d.destination.trim().toLowerCase(), {
    path: ["destination"],
    message: "Pick a different destination",
  });

export const createDepartureSchema = z
  .object({
    routeId: z.string().min(1, "Pick a route"),
    mode: modeEnum.default("BUS"),
    fare: z.coerce.number({ invalid_type_error: "Enter a fare" }).positive("Fare must be greater than 0"),
    departInMinutes: z.coerce.number().int().min(1).default(30),
    durationMinutes: z.coerce.number().int().min(1).default(30),
    capacity: z.coerce.number().int().min(1).default(33),
    vehicleId: z.string().optional(),
    driverId: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.mode === "MOTO" && d.capacity !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capacity"], message: MOTO_CAPACITY_MSG });
    }
  });

export const assignVehicleSchema = z.object({
  vehicleId: z.string().nullable().optional(),
});

export const assignTripSchema = z.object({
  tripId: z.string().min(1, "Pick a departure"),
});

/* ---------------- Self-service profile (any role) ---------------- */
export const updateProfileSchema = z.object({
  firstName: z.string().min(2, "Enter your first name"),
  lastName: z.string().min(2, "Enter your last name"),
  email: z.string().email("Enter a valid email"),
  phone: phoneSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });

/* ---------------- Passenger ---------------- */
export const topUpSchema = z.object({
  amount: z.coerce
    .number({ invalid_type_error: "Enter an amount" })
    .min(100, "Minimum top-up is RWF 100")
    .max(1_000_000, "That's too much"),
  // The number the MoMo/Airtel charge is sent to; empty = the account's phone.
  // Same Rwandan-mobile rules as every other phone field (MTN 078/079,
  // Airtel 072/073) — those are exactly the MoMo/Airtel Money networks.
  phone: z.union([z.literal(""), phoneSchema]).optional(),
});

export const savedPlaceSchema = z.object({
  label: z.string().min(1, "Enter a name"),
  area: z.string().min(1, "Enter an area / address"),
  icon: z.string().optional().default("◎"),
});

/* Inferred types (LoginInput/RegisterInput live in dto.ts to avoid a clash;
   infer inline in components via z.infer<typeof loginSchema> when needed). */
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
export type OperatorOnboardingInput = z.infer<typeof operatorOnboardingSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type DriverInviteInput = z.infer<typeof driverInviteSchema>;
export type DriverKycInput = z.infer<typeof driverKycSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type CreateDepartureInput = z.infer<typeof createDepartureSchema>;
export type TopUpInput = z.infer<typeof topUpSchema>;
export type SavedPlaceInput = z.infer<typeof savedPlaceSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* ---------------- Admin: operator review ---------------- */
// A rejection must carry a reason: it is shown to the applicant verbatim
// (dashboard, in-app notification and email), so it has to be a real sentence.
export const rejectOperatorSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Give the applicant a clear reason (at least 10 characters)")
    .max(1000, "Keep the reason under 1000 characters"),
});
export type RejectOperatorInput = z.infer<typeof rejectOperatorSchema>;

// Operator: (re)assign a vehicle and/or driver to an existing departure.
// Empty strings come from "— none —" select options and mean "clear".
export const assignDepartureSchema = z.object({
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
});
export type AssignDepartureInput = z.infer<typeof assignDepartureSchema>;

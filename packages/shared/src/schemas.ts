import { z } from "zod";

// Single source of truth for form/request validation — used by the API
// (server-side) and the web forms (react-hook-form via zodResolver).
// Numeric fields use z.coerce so the same schema accepts form strings and
// JSON numbers.

export const roleEnum = z.enum(["PASSENGER", "DRIVER", "OPERATOR", "ADMIN"]);
export const modeEnum = z.enum(["BUS", "MOTO", "RIDE"]);
export const paymentMethodEnum = z.enum(["MOBILE_MONEY", "WALLET", "QR"]);

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
  phone: z.string().min(6, "Enter a valid phone number"),
  password: z.string().min(8, "At least 8 characters"),
});

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
  contactInfo: z.string().min(6, "Enter a company contact phone or email"),
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

// Drivers are onboarded exclusively by operators, with KYC: ID number +
// driving licence number, plus their document uploads (validated server-side).
export const inviteDriverSchema = z.object({
  firstName: z.string().min(2, "Enter a first name"),
  lastName: z.string().min(2, "Enter a last name"),
  phone: z.string().min(6, "Enter a phone number"),
  email: z.union([z.string().email("Invalid email"), z.literal("")]).optional(),
  idNumber: z.string().min(5, "Enter the driver's ID number"),
  licenseNumber: z.string().min(4, "Enter the driving licence number"),
});

export const createUserSchema = z
  .object({
    firstName: z.string().min(2, "Enter a first name"),
    lastName: z.string().min(2, "Enter a last name"),
    phone: z.string().min(6, "Enter a phone number"),
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
  phone: z.string().min(6, "Enter a valid phone number"),
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
// MTN MoMo (078/079) or Airtel Money (072/073), with optional +250/250 prefix.
export const momoNumberRegex = /^(\+?250|0)?7[2389]\d{7}$/;

export const topUpSchema = z.object({
  amount: z.coerce
    .number({ invalid_type_error: "Enter an amount" })
    .min(100, "Minimum top-up is RWF 100")
    .max(1_000_000, "That's too much"),
  // The number the MoMo/Airtel charge is sent to; empty = the account's phone.
  // Spaces/dashes are tolerated ("+250 788 123 456") and stripped before check.
  phone: z
    .union([
      z
        .string()
        .transform((v) => v.replace(/[\s-]/g, ""))
        .pipe(z.string().regex(momoNumberRegex, "Enter a valid MTN MoMo or Airtel Money number")),
      z.literal(""),
    ])
    .optional(),
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
export type InviteDriverInput = z.infer<typeof inviteDriverSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type CreateDepartureInput = z.infer<typeof createDepartureSchema>;
export type TopUpInput = z.infer<typeof topUpSchema>;
export type SavedPlaceInput = z.infer<typeof savedPlaceSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

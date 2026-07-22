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

export const registerSchema = z.object({
  fullName: z.string().min(2, "Enter your full name"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(6, "Enter a valid phone number"),
  password: z.string().min(8, "At least 8 characters"),
  role: roleEnum.default("PASSENGER"),
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
export const createVehicleSchema = z.object({
  plateNumber: z.string().min(3, "Enter a plate number"),
  type: modeEnum,
  capacity: z.coerce.number({ invalid_type_error: "Enter a number" }).int("Whole number").min(1, "At least 1"),
  model: z.string().optional().default("—"),
  label: z.string().optional(),
});

export const inviteDriverSchema = z.object({
  fullName: z.string().min(2, "Enter a name"),
  phone: z.string().min(6, "Enter a phone number"),
  email: z.union([z.string().email("Invalid email"), z.literal("")]).optional(),
  vehicleId: z.string().optional(),
});

export const createUserSchema = z.object({
  fullName: z.string().min(2, "Enter a name"),
  phone: z.string().min(6, "Enter a phone number"),
  email: z.string().email("Enter a valid email"),
  role: roleEnum.default("PASSENGER"),
});

export const createRouteSchema = z
  .object({
    originId: z.string().min(1, "Pick an origin"),
    destinationId: z.string().min(1, "Pick a destination"),
    distanceKm: z.coerce.number({ invalid_type_error: "Enter a number" }).positive("Must be greater than 0").default(5),
  })
  .refine((d) => d.originId !== d.destinationId, {
    path: ["destinationId"],
    message: "Pick a different destination",
  });

export const createDepartureSchema = z.object({
  routeId: z.string().min(1, "Pick a route"),
  mode: modeEnum.default("BUS"),
  fare: z.coerce.number({ invalid_type_error: "Enter a fare" }).positive("Fare must be greater than 0"),
  departInMinutes: z.coerce.number().int().min(1).default(30),
  durationMinutes: z.coerce.number().int().min(1).default(30),
  capacity: z.coerce.number().int().min(1).default(33),
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
});

export const assignVehicleSchema = z.object({
  vehicleId: z.string().nullable().optional(),
});

export const assignTripSchema = z.object({
  tripId: z.string().min(1, "Pick a departure"),
});

/* ---------------- Passenger ---------------- */
export const topUpSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: "Enter an amount" }).positive("Enter an amount").max(1_000_000, "That's too much"),
});

export const savedPlaceSchema = z.object({
  label: z.string().min(1, "Enter a name"),
  area: z.string().min(1, "Enter an area / address"),
  icon: z.string().optional().default("◎"),
});

/* Inferred types (LoginInput/RegisterInput live in dto.ts to avoid a clash;
   infer inline in components via z.infer<typeof loginSchema> when needed). */
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type InviteDriverInput = z.infer<typeof inviteDriverSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type CreateDepartureInput = z.infer<typeof createDepartureSchema>;
export type TopUpInput = z.infer<typeof topUpSchema>;
export type SavedPlaceInput = z.infer<typeof savedPlaceSchema>;

// Domain enums shared across API and Web. Mirror the Prisma enums.

export const UserRole = {
  PASSENGER: "PASSENGER",
  DRIVER: "DRIVER",
  OPERATOR: "OPERATOR",
  ADMIN: "ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const TransportMode = {
  BUS: "BUS",
  MOTO: "MOTO",
  RIDE: "RIDE", // shared ride
} as const;
export type TransportMode = (typeof TransportMode)[keyof typeof TransportMode];

export const BookingStatus = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const TripStatus = {
  SCHEDULED: "SCHEDULED",
  BOARDING: "BOARDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export const PaymentMethod = {
  MOBILE_MONEY: "MOBILE_MONEY",
  WALLET: "WALLET",
  QR: "QR",
  SMART_CARD: "SMART_CARD",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const OperatorStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  SUSPENDED: "SUSPENDED",
  REJECTED: "REJECTED",
} as const;
export type OperatorStatus = (typeof OperatorStatus)[keyof typeof OperatorStatus];

// Visual metadata for each transport mode (matches the design palette).
export const MODE_META: Record<
  TransportMode,
  { code: string; label: string; color: string; bg: string }
> = {
  BUS: { code: "B", label: "Bus", color: "#2f6bff", bg: "#e9f0ff" },
  MOTO: { code: "M", label: "Moto-taxi", color: "#ff6a1a", bg: "#fff0e6" },
  RIDE: { code: "R", label: "Shared ride", color: "#7c5cff", bg: "#efeaff" },
};

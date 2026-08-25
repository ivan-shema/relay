import type { Prisma } from "@prisma/client";

// Who may take on-demand moto hails. Drivers are mode-classified by the
// vehicle their operator assigned them, and the operator itself must be a
// verified company that offers MOTO — a bus-only or suspended operator's
// driver never sees a hail, even if they happen to sit on a moto.
export const motoDriverWhere = {
  online: true,
  suspended: false,
  vehicle: { is: { type: "MOTO" } },
  operator: { is: { status: "VERIFIED", modes: { has: "MOTO" } } },
} satisfies Prisma.DriverWhereInput;

type EligibilityInput = {
  suspended: boolean;
  vehicle: { type: string } | null;
  operator: { status: string; modes: string[]; companyName: string } | null;
};

// Human-readable reason a driver cannot take hails right now (ignoring the
// online toggle, which is the driver's own choice), or null when eligible.
export function motoIneligibleReason(d: EligibilityInput): string | null {
  if (d.suspended) return "Your account is suspended.";
  if (!d.vehicle) return "No vehicle is assigned to you yet — ask your operator to assign a moto.";
  if (d.vehicle.type !== "MOTO") return "Moto hailing needs a moto-taxi — your assigned vehicle is a " + d.vehicle.type.toLowerCase() + ".";
  if (!d.operator) return "You are not attached to an operator.";
  if (d.operator.status !== "VERIFIED") return `${d.operator.companyName} is not a verified operator yet.`;
  if (!d.operator.modes.includes("MOTO")) return `${d.operator.companyName} does not offer moto-taxi service.`;
  return null;
}

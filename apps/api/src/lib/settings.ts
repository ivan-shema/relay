import { prisma } from "../prisma";
import { BUS_PLATFORM_FEE_PCT } from "./reports";

// Admin-tunable platform configuration, stored as key/value rows so new knobs
// don't need migrations. Readers always get a value (the default fills in).
//
// Two commissions:
//  - motoCommissionPct    — kept from each moto hail; locked onto the ride when
//                           its fare is agreed.
//  - bookingCommissionPct — kept from each scheduled-trip fare (bus / shared
//                           ride); applied to the operator's payout & reports.

export const MOTO_COMMISSION_KEY = "motoCommissionPct";
export const MOTO_COMMISSION_DEFAULT = 10;
export const BOOKING_COMMISSION_KEY = "bookingCommissionPct";
export const BOOKING_COMMISSION_DEFAULT = BUS_PLATFORM_FEE_PCT;

async function readPct(key: string, fallback: number): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
}

async function writePct(key: string, pct: number): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: String(pct) },
    update: { value: String(pct) },
  });
}

export const getMotoCommissionPct = () => readPct(MOTO_COMMISSION_KEY, MOTO_COMMISSION_DEFAULT);
export const setMotoCommissionPct = (pct: number) => writePct(MOTO_COMMISSION_KEY, pct);
export const getBookingCommissionPct = () => readPct(BOOKING_COMMISSION_KEY, BOOKING_COMMISSION_DEFAULT);
export const setBookingCommissionPct = (pct: number) => writePct(BOOKING_COMMISSION_KEY, pct);

export async function getCommissionPcts() {
  const [motoCommissionPct, bookingCommissionPct] = await Promise.all([getMotoCommissionPct(), getBookingCommissionPct()]);
  return { motoCommissionPct, bookingCommissionPct };
}

import { prisma } from "../prisma";

// Admin-tunable platform configuration, stored as key/value rows so new knobs
// don't need migrations. Readers always get a value (the default fills in).

export const MOTO_COMMISSION_KEY = "motoCommissionPct";
export const MOTO_COMMISSION_DEFAULT = 10;

export async function getMotoCommissionPct(): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key: MOTO_COMMISSION_KEY } });
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : MOTO_COMMISSION_DEFAULT;
}

export async function setMotoCommissionPct(pct: number): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: MOTO_COMMISSION_KEY },
    create: { key: MOTO_COMMISSION_KEY, value: String(pct) },
    update: { value: String(pct) },
  });
}

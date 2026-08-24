// One-off backfill: rewrite every stored phone into the canonical
// +2507XXXXXXXX form now enforced by phoneSchema. Rows that can't be parsed as
// a Rwandan mobile are reported and left untouched. Idempotent.
//   npx tsx prisma/normalize-phones.ts   (from apps/api)
import { PrismaClient } from "@prisma/client";
import { normalizeRwandaPhone } from "@relay/shared";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, phone: true } });
  let changed = 0;
  for (const u of users) {
    const n = normalizeRwandaPhone(u.phone);
    if (!n) {
      console.warn(`[skip] ${u.email}: "${u.phone}" is not a Rwandan mobile number`);
      continue;
    }
    if (n === u.phone) continue;
    const clash = await prisma.user.findFirst({ where: { phone: n, NOT: { id: u.id } } });
    if (clash) {
      console.warn(`[skip] ${u.email}: "${u.phone}" -> ${n} already belongs to ${clash.email}`);
      continue;
    }
    await prisma.user.update({ where: { id: u.id }, data: { phone: n } });
    console.log(`[fix]  ${u.email}: "${u.phone}" -> ${n}`);
    changed++;
  }
  console.log(`Done: ${changed} of ${users.length} users updated.`);
}

main().finally(() => prisma.$disconnect());

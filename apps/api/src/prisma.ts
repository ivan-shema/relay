import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  // Interactive transactions (prisma.$transaction(async tx => ...)) default to
  // a 5s timeout, which a slow or remote Postgres can blow through on a couple
  // of round-trips. Give them room; a real deadlock still fails fast at the DB.
  transactionOptions: {
    maxWait: 10_000, // ms to wait for a connection from the pool
    timeout: 20_000, // ms the transaction may stay open
  },
});

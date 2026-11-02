import { PrismaClient } from '@prisma/client';

let schemaEnsured = false;
let schemaPromise: Promise<void> | null = null;

/**
 * Automatically ensures that the User table has the required
 * isWithdrawalLocked and withdrawalLockReason columns in PostgreSQL.
 * Safe to call concurrently on cold starts across serverless lambda invocations.
 */
export async function ensureUserWithdrawalColumns(prisma: PrismaClient): Promise<void> {
  if (schemaEnsured) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isWithdrawalLocked" BOOLEAN NOT NULL DEFAULT false;
        `);
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "withdrawalLockReason" TEXT;
        `);
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "email" TEXT;
        `);
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "otpSecret" TEXT;
        `);
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'SUPER_ADMIN';
        `);
        schemaEnsured = true;
      } catch (err) {
        console.warn('[Auto-Migration] Notice ensuring User withdrawal columns:', err);
      } finally {
        schemaPromise = null;
      }
    })();
  }
  await schemaPromise;
}

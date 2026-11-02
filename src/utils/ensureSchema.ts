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
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "UserLevelUnlock" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "userId" TEXT NOT NULL,
            "levelNumber" INTEGER NOT NULL,
            "isApproved" BOOLEAN NOT NULL DEFAULT true,
            "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "UserLevelUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
        `);
        await prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS "UserLevelUnlock_userId_levelNumber_key" ON "UserLevelUnlock"("userId", "levelNumber");
        `);
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "UserLevelUnlock_userId_idx" ON "UserLevelUnlock"("userId");
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

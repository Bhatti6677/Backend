import { PrismaClient } from '@prisma/client';
import { prisma, getSecondaryPrisma } from '../prisma';

export const ALL_SYNC_TABLES = [
  'Level',
  'Task',
  'SpinConfiguration',
  'SpinPrize',
  'SiteSetting',
  'Announcement',
  'AdminUser',
  'AdminAuditLog',
  'User',
  'Session',
  'Wallet',
  'WalletTransaction',
  'UserLevelUnlock',
  'UserLevelProgress',
  'UserTaskProgress',
  'TaskSubmission',
  'TaskUnlockTransaction',
  'DepositRequest',
  'WithdrawalRequest',
  'Referral',
  'UserSpinEntitlement',
  'SpinHistory',
  'Notification',
  'AdminReferralCode',
  'TelegramUser',
] as const;

/**
 * Ensures all 25 tables (23 Prisma models + 2 Raw SQL tables) exist on a target PrismaClient database.
 */
export async function ensureFullDatabaseSchema(targetClient: PrismaClient): Promise<void> {
  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "phone" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "referralCode" TEXT NOT NULL UNIQUE,
      "referredById" TEXT,
      "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
      "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
      "isWithdrawalLocked" BOOLEAN NOT NULL DEFAULT false,
      "withdrawalLockReason" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "token" TEXT NOT NULL UNIQUE,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "AdminUser" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL UNIQUE,
      "email" TEXT,
      "passwordHash" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "otpSecret" TEXT,
      "telegramChatId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "Level" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "levelNumber" INTEGER NOT NULL UNIQUE,
      "title" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "requiredTaskCount" INTEGER NOT NULL DEFAULT 10,
      "completionReward" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "totalCreditPoints" INTEGER NOT NULL DEFAULT 0,
      "displayOrder" INTEGER NOT NULL DEFAULT 1,
      "bannerUrl" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "Task" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "levelId" TEXT NOT NULL,
      "taskNumber" INTEGER NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "taskType" TEXT NOT NULL DEFAULT 'Custom Task',
      "rewardAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "creditPoints" INTEGER NOT NULL DEFAULT 0,
      "isPaid" BOOLEAN NOT NULL DEFAULT false,
      "unlockFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "protectedUrl" TEXT,
      "instructions" TEXT NOT NULL,
      "lockMessage" TEXT NOT NULL DEFAULT 'Complete and receive approval for the previous task to unlock this task.',
      "submissionInstructions" TEXT NOT NULL DEFAULT 'Submit task confirmation notes or screenshot reference for admin review.',
      "externalContact" TEXT,
      "requiresAdminApproval" BOOLEAN NOT NULL DEFAULT true,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE ("levelId", "taskNumber")
    );`,
    `CREATE TABLE IF NOT EXISTS "UserLevelProgress" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "levelId" TEXT NOT NULL,
      "completionStatus" TEXT NOT NULL DEFAULT 'LOCKED',
      "approvedTaskCount" INTEGER NOT NULL DEFAULT 0,
      "completedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", "levelId")
    );`,
    `CREATE TABLE IF NOT EXISTS "UserTaskProgress" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'LOCKED',
      "isPaidUnlocked" BOOLEAN NOT NULL DEFAULT false,
      "unlockedAt" TIMESTAMP(3),
      "submissionAt" TIMESTAMP(3),
      "approvedAt" TIMESTAMP(3),
      "reviewerId" TEXT,
      "rejectionReason" TEXT,
      "completedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", "taskId")
    );`,
    `CREATE TABLE IF NOT EXISTS "TaskSubmission" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "submissionNotes" TEXT,
      "proofEvidence" TEXT,
      "reviewerId" TEXT,
      "reviewerName" TEXT,
      "reviewNotes" TEXT,
      "rejectionReason" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "TaskUnlockTransaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "unlockFee" DOUBLE PRECISION NOT NULL,
      "transactionId" TEXT NOT NULL UNIQUE,
      "status" TEXT NOT NULL DEFAULT 'COMPLETED',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "Wallet" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL UNIQUE,
      "currency" TEXT NOT NULL DEFAULT 'PKR',
      "availableBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "pendingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "totalEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "totalDeposited" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "totalWithdrawn" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "totalUnlockFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "creditPoints" INTEGER NOT NULL DEFAULT 100,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "WalletTransaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "transactionType" TEXT NOT NULL,
      "amount" DOUBLE PRECISION NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'PKR',
      "status" TEXT NOT NULL DEFAULT 'COMPLETED',
      "relatedEntityId" TEXT,
      "idempotencyKey" TEXT UNIQUE,
      "actorId" TEXT,
      "actorName" TEXT,
      "reason" TEXT NOT NULL,
      "notes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "DepositRequest" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "amount" DOUBLE PRECISION NOT NULL,
      "paymentMethod" TEXT NOT NULL,
      "transactionReference" TEXT NOT NULL,
      "proofEvidence" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "reviewerId" TEXT,
      "reviewerName" TEXT,
      "reviewNotes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "WithdrawalRequest" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "amount" DOUBLE PRECISION NOT NULL,
      "paymentMethod" TEXT NOT NULL,
      "recipientName" TEXT NOT NULL,
      "recipientAccount" TEXT NOT NULL,
      "notes" TEXT,
      "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
      "paymentStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
      "reviewerId" TEXT,
      "reviewerName" TEXT,
      "reviewNotes" TEXT,
      "payoutReference" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "Referral" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "referrerId" TEXT NOT NULL,
      "referredId" TEXT NOT NULL,
      "qualifyingStatus" TEXT NOT NULL DEFAULT 'PENDING',
      "rewardStatus" TEXT NOT NULL DEFAULT 'PENDING',
      "rewardAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("referrerId", "referredId")
    );`,
    `CREATE TABLE IF NOT EXISTS "SpinConfiguration" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL DEFAULT 'Default Royal Spin',
      "isEnabled" BOOLEAN NOT NULL DEFAULT true,
      "minLevelRequired" INTEGER NOT NULL DEFAULT 1,
      "referralsRequired" INTEGER NOT NULL DEFAULT 0,
      "cooldownHours" INTEGER NOT NULL DEFAULT 24,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "SpinPrize" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "prizeType" TEXT NOT NULL DEFAULT 'CASH',
      "monetaryValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "displayLabel" TEXT NOT NULL,
      "color" TEXT NOT NULL DEFAULT '#1459E8',
      "icon" TEXT DEFAULT 'Crown',
      "inventory" INTEGER NOT NULL DEFAULT 999999,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "UserSpinEntitlement" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "assignedPrizeId" TEXT,
      "totalSpins" INTEGER NOT NULL DEFAULT 1,
      "remainingSpins" INTEGER NOT NULL DEFAULT 1,
      "isEligible" BOOLEAN NOT NULL DEFAULT true,
      "triggerReason" TEXT,
      "levelNumber" INTEGER,
      "taskNumber" INTEGER,
      "requiresAdminReview" BOOLEAN NOT NULL DEFAULT false,
      "adminReviewed" BOOLEAN NOT NULL DEFAULT false,
      "expiresAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "SpinHistory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "entitlementId" TEXT,
      "prizeId" TEXT NOT NULL,
      "resultLabel" TEXT NOT NULL,
      "prizeValue" DOUBLE PRECISION NOT NULL,
      "rewardStatus" TEXT NOT NULL DEFAULT 'CREDITED',
      "transactionId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "Notification" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "notificationType" TEXT NOT NULL DEFAULT 'SYSTEM',
      "isRead" BOOLEAN NOT NULL DEFAULT false,
      "linkUrl" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "Announcement" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "audience" TEXT NOT NULL DEFAULT 'ALL',
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "startDate" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
      "endDate" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "adminId" TEXT,
      "adminUsername" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      "previousState" TEXT,
      "newState" TEXT,
      "reason" TEXT,
      "ipAddress" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "SiteSetting" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "key" TEXT NOT NULL UNIQUE,
      "value" TEXT NOT NULL,
      "description" TEXT,
      "category" TEXT NOT NULL DEFAULT 'GENERAL',
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "UserLevelUnlock" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "levelNumber" INTEGER NOT NULL,
      "isApproved" BOOLEAN NOT NULL DEFAULT true,
      "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", "levelNumber")
    );`,
    `CREATE TABLE IF NOT EXISTS "AdminReferralCode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
      "usedById" TEXT,
      "usedByName" TEXT,
      "usedByPhone" TEXT,
      "usedAt" TIMESTAMP(3),
      "notes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS "TelegramUser" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "chatId" TEXT NOT NULL UNIQUE,
      "username" TEXT,
      "firstName" TEXT,
      "status" TEXT NOT NULL DEFAULT 'REGISTERED',
      "totalQuota" INT NOT NULL DEFAULT 10,
      "codesGenerated" INT NOT NULL DEFAULT 0,
      "remainingQuota" INT NOT NULL DEFAULT 10,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  ];

  for (const sql of ddlStatements) {
    try {
      await targetClient.$executeRawUnsafe(sql);
    } catch (err) {
      // Ignore if already exists
    }
  }
}

/**
 * Fetches row counts for key tables and total row count for a PrismaClient instance.
 */
export async function getDatabaseStats(client: PrismaClient | null) {
  if (!client) {
    return {
      connected: false,
      error: 'Not configured',
      totalRows: 0,
      tables: {} as Record<string, number>,
    };
  }

  try {
    const tables: Record<string, number> = {};
    let totalRows = 0;

    // Single combined SQL query to count all 25 tables in 1 round-trip
    const unionParts = ALL_SYNC_TABLES.map(
      (t) => `SELECT '${t}' AS tbl, (SELECT COUNT(*)::int FROM "${t}") AS cnt`
    ).join(' UNION ALL ');

    try {
      const rows: Array<{ tbl: string; cnt: number }> = await client.$queryRawUnsafe(unionParts);
      for (const r of rows) {
        const count = Number(r.cnt || 0);
        tables[r.tbl] = count;
        totalRows += count;
      }
    } catch {
      // Fallback to individual counts if any table is missing on secondary
      for (const tableName of ALL_SYNC_TABLES) {
        try {
          const rows: any[] = await client.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS cnt FROM "${tableName}"`
          );
          const count = Number(rows?.[0]?.cnt || 0);
          tables[tableName] = count;
          totalRows += count;
        } catch {
          tables[tableName] = 0;
        }
      }
    }

    return {
      connected: true,
      error: null,
      totalRows,
      tables,
    };
  } catch (err: any) {
    return {
      connected: false,
      error: err?.message || 'Connection failed',
      totalRows: 0,
      tables: {} as Record<string, number>,
    };
  }
}

/**
 * Clones all 25 tables from sourceClient to targetClient in dependency order.
 */
export async function cloneDatabaseData(
  sourceClient: PrismaClient,
  targetClient: PrismaClient
): Promise<{
  success: boolean;
  totalSyncedRows: number;
  tableSummary: Record<string, number>;
}> {
  await ensureFullDatabaseSchema(targetClient);

  const tableSummary: Record<string, number> = {};
  let totalSyncedRows = 0;

  // 1. Prisma models in foreign-key dependency order
  const prismaModelSteps: Array<{
    table: string;
    delegate: string;
    uniqueWhere: (row: any) => any;
  }> = [
    { table: 'Level', delegate: 'level', uniqueWhere: (r) => ({ id: r.id }) },
    { table: 'Task', delegate: 'task', uniqueWhere: (r) => ({ id: r.id }) },
    { table: 'SpinConfiguration', delegate: 'spinConfiguration', uniqueWhere: (r) => ({ id: r.id }) },
    { table: 'SpinPrize', delegate: 'spinPrize', uniqueWhere: (r) => ({ id: r.id }) },
    { table: 'SiteSetting', delegate: 'siteSetting', uniqueWhere: (r) => ({ key: r.key }) },
    { table: 'Announcement', delegate: 'announcement', uniqueWhere: (r) => ({ id: r.id }) },
    { table: 'AdminUser', delegate: 'adminUser', uniqueWhere: (r) => ({ id: r.id }) },
    { table: 'AdminAuditLog', delegate: 'adminAuditLog', uniqueWhere: (r) => ({ id: r.id }) },
  ];

  for (const step of prismaModelSteps) {
    const rows: any[] = await (sourceClient as any)[step.delegate].findMany();
    let count = 0;
    for (const row of rows) {
      // Do not overwrite secondary_database_url loop on target
      await (targetClient as any)[step.delegate]
        .upsert({
          where: step.uniqueWhere(row),
          update: row,
          create: row,
        })
        .catch(async () => {
          await (targetClient as any)[step.delegate].createMany({
            data: [row],
            skipDuplicates: true,
          });
        });
      count++;
    }
    tableSummary[step.table] = count;
    totalSyncedRows += count;
  }

  // 2. Users (two-pass to handle self-referencing referredById safely)
  const users: any[] = await sourceClient.user.findMany();
  for (const u of users) {
    const withoutRef = { ...u, referredById: null };
    await targetClient.user
      .upsert({
        where: { id: u.id },
        update: withoutRef,
        create: withoutRef,
      })
      .catch(() => {});
  }
  for (const u of users) {
    if (u.referredById) {
      await targetClient.user
        .update({
          where: { id: u.id },
          data: { referredById: u.referredById },
        })
        .catch(() => {});
    }
  }
  tableSummary['User'] = users.length;
  totalSyncedRows += users.length;

  // 3. Dependent user tables via createMany(skipDuplicates) + upsert for mutable tables
  const mutableDependentDelegates: Array<{ table: string; delegate: string }> = [
    { table: 'Wallet', delegate: 'wallet' },
    { table: 'UserLevelUnlock', delegate: 'userLevelUnlock' },
    { table: 'UserLevelProgress', delegate: 'userLevelProgress' },
    { table: 'UserTaskProgress', delegate: 'userTaskProgress' },
    { table: 'TaskSubmission', delegate: 'taskSubmission' },
    { table: 'DepositRequest', delegate: 'depositRequest' },
    { table: 'WithdrawalRequest', delegate: 'withdrawalRequest' },
    { table: 'Referral', delegate: 'referral' },
    { table: 'UserSpinEntitlement', delegate: 'userSpinEntitlement' },
    { table: 'Notification', delegate: 'notification' },
  ];

  for (const step of mutableDependentDelegates) {
    const rows: any[] = await (sourceClient as any)[step.delegate].findMany();
    if (rows.length > 0) {
      await (targetClient as any)[step.delegate]
        .createMany({
          data: rows,
          skipDuplicates: true,
        })
        .catch(() => {});

      // Upsert latest mutable rows (or all if <= 300 rows)
      const toUpdate = rows.length <= 300 ? rows : rows.slice(-200);
      for (const r of toUpdate) {
        await (targetClient as any)[step.delegate]
          .upsert({
            where: { id: r.id },
            update: r,
            create: r,
          })
          .catch(() => {});
      }
    }
    tableSummary[step.table] = rows.length;
    totalSyncedRows += rows.length;
  }

  const appendOnlyDelegates: Array<{ table: string; delegate: string }> = [
    { table: 'Session', delegate: 'session' },
    { table: 'WalletTransaction', delegate: 'walletTransaction' },
    { table: 'TaskUnlockTransaction', delegate: 'taskUnlockTransaction' },
    { table: 'SpinHistory', delegate: 'spinHistory' },
  ];

  for (const step of appendOnlyDelegates) {
    const rows: any[] = await (sourceClient as any)[step.delegate].findMany();
    if (rows.length > 0) {
      await (targetClient as any)[step.delegate]
        .createMany({
          data: rows,
          skipDuplicates: true,
        })
        .catch(() => {});
    }
    tableSummary[step.table] = rows.length;
    totalSyncedRows += rows.length;
  }

  // 4. Raw SQL tables: AdminReferralCode and TelegramUser
  try {
    const refCodes: any[] = await sourceClient.$queryRawUnsafe(
      `SELECT * FROM "AdminReferralCode"`
    );
    for (const rc of refCodes) {
      await targetClient.$executeRawUnsafe(
        `INSERT INTO "AdminReferralCode" ("id", "code", "status", "usedById", "usedByName", "usedByPhone", "usedAt", "notes", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ("code") DO UPDATE SET
           "status" = EXCLUDED."status",
           "usedById" = EXCLUDED."usedById",
           "usedByName" = EXCLUDED."usedByName",
           "usedByPhone" = EXCLUDED."usedByPhone",
           "usedAt" = EXCLUDED."usedAt",
           "notes" = EXCLUDED."notes",
           "updatedAt" = EXCLUDED."updatedAt"`,
        rc.id,
        rc.code,
        rc.status,
        rc.usedById,
        rc.usedByName,
        rc.usedByPhone,
        rc.usedAt,
        rc.notes,
        rc.createdAt,
        rc.updatedAt
      );
    }
    tableSummary['AdminReferralCode'] = refCodes.length;
    totalSyncedRows += refCodes.length;
  } catch {
    tableSummary['AdminReferralCode'] = 0;
  }

  try {
    const tgUsers: any[] = await sourceClient.$queryRawUnsafe(
      `SELECT * FROM "TelegramUser"`
    );
    for (const tg of tgUsers) {
      await targetClient.$executeRawUnsafe(
        `INSERT INTO "TelegramUser" ("id", "chatId", "username", "firstName", "status", "totalQuota", "codesGenerated", "remainingQuota", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ("chatId") DO UPDATE SET
           "username" = EXCLUDED."username",
           "firstName" = EXCLUDED."firstName",
           "status" = EXCLUDED."status",
           "totalQuota" = EXCLUDED."totalQuota",
           "codesGenerated" = EXCLUDED."codesGenerated",
           "remainingQuota" = EXCLUDED."remainingQuota",
           "updatedAt" = EXCLUDED."updatedAt"`,
        tg.id,
        tg.chatId,
        tg.username,
        tg.firstName,
        tg.status,
        tg.totalQuota,
        tg.codesGenerated,
        tg.remainingQuota,
        tg.createdAt,
        tg.updatedAt
      );
    }
    tableSummary['TelegramUser'] = tgUsers.length;
    totalSyncedRows += tgUsers.length;
  } catch {
    tableSummary['TelegramUser'] = 0;
  }

  return {
    success: true,
    totalSyncedRows,
    tableSummary,
  };
}

/**
 * Wipes all data from a target database (e.g. when retiring the Old Supabase instance).
 */
export async function wipeDatabaseData(targetClient: PrismaClient): Promise<{
  success: boolean;
  tablesWiped: number;
}> {
  const reverseTables = [...ALL_SYNC_TABLES].reverse();
  let wiped = 0;
  for (const table of reverseTables) {
    try {
      await targetClient.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      wiped++;
    } catch {
      try {
        await targetClient.$executeRawUnsafe(`DELETE FROM "${table}";`);
        wiped++;
      } catch {}
    }
  }
  return { success: true, tablesWiped: wiped };
}

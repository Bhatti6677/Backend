import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust multi-path dotenv loading (supports direct execution, root monorepo, and serverless bundle)
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// New Supabase Database (Standalone Primary Database — Disconnected from Old Supabase)
export const NEW_SUPABASE_URL =
  'postgresql://postgres.vzgjygtbdkezaerygjbp:*7HBHpKRz5U_z66@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
export const NEW_SUPABASE_DIRECT_URL =
  'postgresql://postgres.vzgjygtbdkezaerygjbp:*7HBHpKRz5U_z66@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

const FALLBACK_DATABASE_URL = NEW_SUPABASE_URL;
const FALLBACK_DIRECT_URL = NEW_SUPABASE_DIRECT_URL;

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = FALLBACK_DATABASE_URL;
}
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = FALLBACK_DIRECT_URL;
}

const dbUrl = process.env.DATABASE_URL || FALLBACK_DATABASE_URL;

// Disconnected from Old Supabase by default
const DEFAULT_SECONDARY_URL = '';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  secondaryPrisma: PrismaClient | null | undefined;
  secondaryDbUrl: string | undefined;
  dualSyncEnabled: boolean | undefined;
  dualSyncMiddlewareInstalled: boolean | undefined;
  rawSqlHookInstalled: boolean | undefined;
  lastDualSyncConfigFetch: number | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;

const WRITE_ACTIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * Returns or initializes the optional secondary PrismaClient instance if explicitly configured.
 */
export function getSecondaryPrisma(customUrl?: string): PrismaClient | null {
  const targetUrl = (
    customUrl ??
    globalForPrisma.secondaryDbUrl ??
    process.env.SECONDARY_DATABASE_URL ??
    DEFAULT_SECONDARY_URL
  ).trim();
  if (!targetUrl || targetUrl === dbUrl) {
    return null;
  }

  if (globalForPrisma.secondaryPrisma && globalForPrisma.secondaryDbUrl === targetUrl) {
    return globalForPrisma.secondaryPrisma;
  }

  try {
    if (globalForPrisma.secondaryPrisma) {
      globalForPrisma.secondaryPrisma.$disconnect().catch(() => {});
    }
    const client = new PrismaClient({
      datasources: {
        db: {
          url: targetUrl,
        },
      },
      log: ['error'],
    });
    globalForPrisma.secondaryPrisma = client;
    globalForPrisma.secondaryDbUrl = targetUrl;
    return client;
  } catch (err) {
    console.warn('[Dual-Sync] Failed to initialize secondary Prisma client:', err);
    return null;
  }
}

/**
 * Updates the runtime Dual-Sync configuration immediately without requiring a server restart.
 */
export function setDualSyncRuntimeConfig(secondaryUrl: string, enabled: boolean) {
  globalForPrisma.secondaryDbUrl = secondaryUrl.trim();
  globalForPrisma.dualSyncEnabled = enabled;
  globalForPrisma.lastDualSyncConfigFetch = Date.now();
  if (globalForPrisma.secondaryDbUrl && enabled) {
    getSecondaryPrisma(globalForPrisma.secondaryDbUrl);
  }
}

export function getDualSyncRuntimeConfig() {
  return {
    primaryDbUrl: dbUrl,
    secondaryDbUrl:
      globalForPrisma.secondaryDbUrl ??
      process.env.SECONDARY_DATABASE_URL ??
      DEFAULT_SECONDARY_URL,
    dualSyncEnabled: globalForPrisma.dualSyncEnabled ?? false,
  };
}

/**
 * Refreshes Dual-Sync settings from SiteSetting table periodically (every 15 seconds).
 */
export async function refreshDualSyncConfigIfNeeded(): Promise<void> {
  const now = Date.now();
  if (
    globalForPrisma.lastDualSyncConfigFetch &&
    now - globalForPrisma.lastDualSyncConfigFetch < 15000
  ) {
    return;
  }
  globalForPrisma.lastDualSyncConfigFetch = now;

  try {
    const records = await prisma.siteSetting.findMany({
      where: {
        key: {
          in: ['secondary_database_url', 'dual_sync_enabled'],
        },
      },
    });
    const map = Object.fromEntries(records.map((r) => [r.key, r.value]));
    const secUrl = (map.secondary_database_url ?? process.env.SECONDARY_DATABASE_URL ?? '').trim();
    const enabled = map.dual_sync_enabled === 'true' && Boolean(secUrl);
    globalForPrisma.secondaryDbUrl = secUrl;
    globalForPrisma.dualSyncEnabled = enabled;
  } catch {
    globalForPrisma.secondaryDbUrl = '';
    globalForPrisma.dualSyncEnabled = false;
  }
}

/**
 * Mirrors raw SQL mutations ($executeRawUnsafe) to the secondary database only when Dual-Sync is explicitly enabled.
 */
export async function executeDualRawUnsafe(query: string, ...values: any[]): Promise<void> {
  try {
    await refreshDualSyncConfigIfNeeded();
    if (!globalForPrisma.dualSyncEnabled) return;
    const secondary = getSecondaryPrisma();
    if (!secondary) return;
    await secondary.$executeRawUnsafe(query, ...values);
  } catch (err) {
    console.warn('[Dual-Sync Raw SQL Warning] Secondary DB write skipped:', (err as any)?.message || err);
  }
}

if (!globalForPrisma.rawSqlHookInstalled && typeof prisma.$executeRawUnsafe === 'function') {
  globalForPrisma.rawSqlHookInstalled = true;
  const origExecuteRawUnsafe = prisma.$executeRawUnsafe.bind(prisma);
  (prisma as any).$executeRawUnsafe = async (query: string, ...values: any[]) => {
    const res = await origExecuteRawUnsafe(query, ...values);
    executeDualRawUnsafe(query, ...values).catch(() => {});
    return res;
  };
}

if (!globalForPrisma.dualSyncMiddlewareInstalled && typeof (prisma as any).$use === 'function') {
  globalForPrisma.dualSyncMiddlewareInstalled = true;

  (prisma as any).$use(async (params: any, next: any) => {
    const result = await next(params);

    if (params.model && WRITE_ACTIONS.has(params.action)) {
      (async () => {
        try {
          await refreshDualSyncConfigIfNeeded();
          if (!globalForPrisma.dualSyncEnabled) return;
          const secondary = getSecondaryPrisma();
          if (!secondary) return;

          const modelKey = params.model.charAt(0).toLowerCase() + params.model.slice(1);
          const delegate = (secondary as any)[modelKey];
          if (!delegate) return;

          if (params.action === 'create' && result && result.id && params.args?.data) {
            await delegate
              .create({
                ...params.args,
                data: {
                  ...params.args.data,
                  id: result.id,
                },
              })
              .catch(async () => {
                await delegate.upsert({
                  where: { id: result.id },
                  update: { ...params.args.data },
                  create: { ...params.args.data, id: result.id },
                });
              });
          } else if (typeof delegate[params.action] === 'function') {
            await delegate[params.action](params.args);
          }
        } catch (err) {
          console.warn(
            `[Dual-Sync] Non-blocking mirror error on ${params.model}.${params.action}:`,
            (err as any)?.message || err
          );
        }
      })();
    }

    return result;
  });
}

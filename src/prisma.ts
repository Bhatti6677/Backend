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

const FALLBACK_DATABASE_URL =
  'postgresql://postgres.vzgjygtbdkezaerygjbp:*7HBHpKRz5U_z66@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const FALLBACK_DIRECT_URL =
  'postgresql://postgres.vzgjygtbdkezaerygjbp:*7HBHpKRz5U_z66@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = FALLBACK_DATABASE_URL;
}
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = FALLBACK_DIRECT_URL;
}

const dbUrl = process.env.DATABASE_URL || FALLBACK_DATABASE_URL;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
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


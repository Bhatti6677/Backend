import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isProd = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET || (isProd ? '' : 'dev-local-jwt-secret-key-32charslong!');
const adminSecret = process.env.ADMIN_SECRET || (isProd ? '' : 'dev-local-admin-secret-key-32charslong!');

if (isProd && (!jwtSecret || !adminSecret)) {
  console.warn('⚠️ CRITICAL WARNING: JWT_SECRET or ADMIN_SECRET is not configured in environment variables.');
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  jwtSecret: jwtSecret || 'dev-local-jwt-secret-key-32charslong!',
  adminSecret: adminSecret || 'dev-local-admin-secret-key-32charslong!',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

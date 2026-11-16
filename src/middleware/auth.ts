import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma';

export interface AuthenticatedUser {
  id: string;
  phone: string;
  name: string;
  referralCode: string;
  accountStatus: string;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Authentication token is missing' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as {
      userId: string;
      pwdSig?: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        phone: true,
        name: true,
        referralCode: true,
        accountStatus: true,
        passwordHash: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User no longer exists' });
    }

    if (user.accountStatus === 'SUSPENDED') {
      return res.status(403).json({ error: 'Account suspended. Please contact Earn Street support.' });
    }

    // Invalidate token if password was changed after token issuance
    if (decoded.pwdSig && user.passwordHash) {
      const currentSig = user.passwordHash.slice(-8);
      if (decoded.pwdSig !== currentSig) {
        return res.status(401).json({ error: 'Unauthorized: Password was changed. Please log in again.' });
      }
    }

    const { passwordHash: _unused, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}

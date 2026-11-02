import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config } from '../config';
import { requireAdmin, requireSuperAdmin, AdminAuthRequest } from '../middleware/adminAuth';
import { logAdminAction } from '../services/auditService';
import { taskProgressionService } from '../services/taskProgressionService';
import { affiliateService } from '../services/affiliateService';
import { sendUserLiveCommand } from '../utils/supabase';
import { ensureOfficialSpinPrizes } from '../services/spinPrizeService';
import {
  getMiniAdminOtp,
  verifyMiniAdminOtp,
  generateOtpSecret,
} from '../services/miniAdminOtpService';
import {
  getAdminReferralCodesOverview,
  generateAdditionalCodes,
  ensureAdminReferralCodes,
} from '../services/adminReferralService';
import {
  getAllLevelWithdrawalNotices,
  getLevelWithdrawalNotice,
  setLevelWithdrawalNotice,
  DEFAULT_LEVEL_WITHDRAWAL_NOTICES,
} from '../services/levelNoticeService';
import {
  getAllTelegramUsers,
  grantMoreCodesToTelegramUser,
} from '../services/telegramService';
import { ensureUserWithdrawalColumns } from '../utils/ensureSchema';

const router = Router();

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

const adminLoginSchema = z.object({
  username: z.string().min(1, 'Username or Gmail is required'),
  password: z.string().min(1, 'Password is required'),
  otp: z.string().optional(),
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password, otp } = adminLoginSchema.parse(req.body);
    const input = username.trim();

    const admin = await prisma.adminUser.findFirst({
      where: {
        OR: [
          { username: { equals: input, mode: 'insensitive' } },
          { email: { equals: input, mode: 'insensitive' } },
        ],
      },
    });

    if (!admin || admin.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid administrator credentials' });
    }

    const isValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid administrator credentials' });
    }

    // Role-specific check: Mini Admins MUST provide a valid 10-minute dynamic OTP
    if (admin.role === 'MINI_ADMIN') {
      if (!otp || !otp.trim()) {
        return res.status(400).json({
          error: '10-minute dynamic OTP is required for Mini Admin login. Please obtain the current OTP from the Master Admin.',
          requiresOtp: true,
        });
      }

      if (!admin.otpSecret || !verifyMiniAdminOtp(admin.otpSecret, otp.trim())) {
        return res.status(401).json({
          error: 'Invalid or expired 10-minute OTP. Please check the current active OTP with Master Admin.',
          requiresOtp: true,
        });
      }
    }

    const token = jwt.sign(
      { adminId: admin.id, role: admin.role, username: admin.username },
      config.adminSecret,
      { expiresIn: '24h' }
    );

    await logAdminAction({
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'ADMIN_LOGIN',
      entityType: 'AdminUser',
      entityId: admin.id,
      details: { role: admin.role, email: admin.email },
      ipAddress: req.ip,
    });

    res.json({
      message: 'Admin authentication successful',
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAdmin, (req: AdminAuthRequest, res: Response) => {
  res.json({ admin: req.admin });
});

// ==========================================
// 1.5 NOTIFICATIONS & PENDING QUANTITY COUNTS
// ==========================================

router.get(['/notifications/counts', '/pending-counts'], requireAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';

    if (isMiniAdmin) {
      const pendingTasks = await prisma.taskSubmission.count({
        where: {
          status: 'PENDING',
          task: { level: { levelNumber: 1 } },
        },
      });

      return res.json({
        success: true,
        counts: {
          total: pendingTasks,
          tasks: pendingTasks,
          submissions: pendingTasks,
          spins: 0,
          deposits: 0,
          withdrawals: 0,
        },
      });
    }

    const [
      pendingTasks,
      pendingSpinsHistory,
      pendingSpinsEntitlement,
      pendingDeposits,
      pendingWithdrawals,
    ] = await Promise.all([
      prisma.taskSubmission.count({ where: { status: 'PENDING' } }),
      prisma.spinHistory.count({ where: { rewardStatus: 'PENDING' } }),
      prisma.userSpinEntitlement.count({ where: { requiresAdminReview: true, adminReviewed: false } }),
      prisma.depositRequest.count({ where: { status: 'PENDING' } }),
      prisma.withdrawalRequest.count({
        where: {
          OR: [
            { approvalStatus: 'PENDING' },
            { approvalStatus: 'APPROVED', paymentStatus: 'NOT_SENT' },
          ],
        },
      }),
    ]);

    const pendingSpins = pendingSpinsHistory + pendingSpinsEntitlement;
    const total = pendingTasks + pendingSpins + pendingDeposits + pendingWithdrawals;

    res.json({
      success: true,
      counts: {
        total,
        tasks: pendingTasks,
        submissions: pendingTasks,
        spins: pendingSpins,
        deposits: pendingDeposits,
        withdrawals: pendingWithdrawals,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2. ADMIN DASHBOARD & SUMMARY
// ==========================================

router.get('/dashboard', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';

    if (isMiniAdmin) {
      const [
        totalUsers,
        activeUsers,
        totalTasks,
        pendingSubmissions,
        approvedLevel1Rewards,
        recentActivity,
      ] = await Promise.all([
        prisma.user.count({
          where: {
            taskProgress: {
              none: {
                status: 'APPROVED',
                task: { level: { levelNumber: { gt: 1 } } },
              },
            },
          },
        }),
        prisma.user.count({
          where: {
            accountStatus: 'ACTIVE',
            taskProgress: {
              none: {
                status: 'APPROVED',
                task: { level: { levelNumber: { gt: 1 } } },
              },
            },
          },
        }),
        prisma.task.count({ where: { level: { levelNumber: 1 } } }),
        prisma.taskSubmission.count({
          where: {
            status: 'PENDING',
            task: { level: { levelNumber: 1 } },
          },
        }),
        prisma.walletTransaction.aggregate({
          where: {
            transactionType: 'TASK_REWARD',
            status: 'COMPLETED',
            user: {
              levelProgress: {
                some: { level: { levelNumber: 1 } },
              },
            },
          },
          _sum: { amount: true },
        }),
        prisma.adminAuditLog.findMany({
          where: {
            OR: [
              { adminId: req.admin!.id },
              { action: { in: ['TASK_SUBMISSION_APPROVE', 'TASK_SUBMISSION_REJECT'] } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
        }),
      ]);

      return res.json({
        metrics: {
          totalUsers,
          activeUsers,
          totalTasks,
          pendingSubmissions,
          pendingDeposits: 0,
          pendingWithdrawals: 0,
          totalDepositsAmount: 0,
          totalPaidWithdrawalsAmount: 0,
          totalApprovedRewardsAmount: approvedLevel1Rewards._sum.amount || 0,
          totalReferrals: 0,
        },
        recentActivity,
        recentTransactions: [],
      });
    }

    const [
      totalUsers,
      activeUsers,
      totalTasks,
      pendingSubmissions,
      pendingDeposits,
      pendingWithdrawals,
      approvedDepositsSum,
      paidWithdrawalsSum,
      approvedRewardsSum,
      totalReferrals,
      recentActivity,
      recentTransactions,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { accountStatus: 'ACTIVE' } }),
      prisma.task.count(),
      prisma.taskSubmission.count({ where: { status: 'PENDING' } }),
      prisma.depositRequest.count({ where: { status: 'PENDING' } }),
      prisma.withdrawalRequest.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.depositRequest.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true },
      }),
      prisma.withdrawalRequest.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.walletTransaction.aggregate({
        where: {
          transactionType: { in: ['TASK_REWARD', 'LEVEL_REWARD', 'REFERRAL_REWARD', 'SPIN_REWARD'] },
          status: 'COMPLETED',
        },
        _sum: { amount: true },
      }),
      prisma.referral.count(),
      prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.walletTransaction.findMany({
        include: { user: { select: { name: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    res.json({
      metrics: {
        totalUsers,
        activeUsers,
        totalTasks,
        pendingSubmissions,
        pendingDeposits,
        pendingWithdrawals,
        totalDepositsAmount: approvedDepositsSum._sum.amount || 0,
        totalPaidWithdrawalsAmount: paidWithdrawalsSum._sum.amount || 0,
        totalApprovedRewardsAmount: approvedRewardsSum._sum.amount || 0,
        totalReferrals,
      },
      recentActivity,
      recentTransactions,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 3. 10x10 TASK STATUS OVERVIEW GRID
// ==========================================

router.get('/tasks/grid', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    const levels = await prisma.level.findMany({
      where: isMiniAdmin ? { levelNumber: 1 } : undefined,
      orderBy: { levelNumber: 'asc' },
      include: {
        tasks: {
          orderBy: { taskNumber: 'asc' },
          include: {
            submissions: {
              where: { status: 'PENDING' },
              select: { id: true },
            },
          },
        },
      },
    });

    const grid = levels.map((lvl) => {
      const tasksMap: any = {};
      for (let t = 1; t <= 10; t++) {
        const task = lvl.tasks.find((taskItem) => taskItem.taskNumber === t);
        if (task) {
          tasksMap[`task${t}`] = {
            id: task.id,
            taskNumber: t,
            title: task.title,
            rewardAmount: task.rewardAmount,
            isPaid: task.isPaid,
            unlockFee: task.unlockFee,
            status: task.status,
            pendingSubmissionsCount: task.submissions.length,
          };
        } else {
          tasksMap[`task${t}`] = {
            taskNumber: t,
            title: `Unconfigured Task ${t}`,
            status: 'UNCONFIGURED',
            pendingSubmissionsCount: 0,
          };
        }
      }

      return {
        levelId: lvl.id,
        levelNumber: lvl.levelNumber,
        levelTitle: lvl.title,
        levelStatus: lvl.status,
        tasks: tasksMap,
      };
    });

    res.json({ grid });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. USER MANAGEMENT
// ==========================================

router.get('/users', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    const search = (req.query.search as string || '').trim();
    const status = (req.query.status as string || '').trim();
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.accountStatus = status;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { referralCode: { contains: search, mode: 'insensitive' } },
        { id: { contains: search } },
      ];
    }

    // Role-specific scope: Mini Admins can ONLY view Level 1 users
    if (isMiniAdmin) {
      where.AND = [
        ...(where.AND || []),
        {
          taskProgress: {
            none: {
              status: 'APPROVED',
              task: { level: { levelNumber: { gt: 1 } } },
            },
          },
        },
        {
          levelProgress: {
            none: {
              level: { levelNumber: { gt: 1 } },
              approvedTaskCount: { gt: 0 },
            },
          },
        },
      ];
    }

    let users: any[];
    let total: number;
    try {
      [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          include: {
            wallet: true,
            _count: {
              select: {
                taskProgress: { where: { status: 'APPROVED' } },
                referrals: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.user.count({ where }),
      ]);
    } catch (err: any) {
      if (String(err?.message).includes('isWithdrawalLocked') || String(err?.message).includes('column')) {
        await ensureUserWithdrawalColumns(prisma);
        [users, total] = await Promise.all([
          prisma.user.findMany({
            where,
            include: {
              wallet: true,
              _count: {
                select: {
                  taskProgress: { where: { status: 'APPROVED' } },
                  referrals: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
          prisma.user.count({ where }),
        ]);
      } else {
        throw err;
      }
    }

    let formattedUsers = users.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      referralCode: u.referralCode,
      referredById: u.referredById,
      accountStatus: u.accountStatus,
      isWithdrawalLocked: u.isWithdrawalLocked,
      withdrawalLockReason: u.withdrawalLockReason,
      createdAt: u.createdAt,
      walletBalance: isMiniAdmin ? 0 : (u.wallet?.availableBalance || 0),
      creditPoints: isMiniAdmin ? 100 : (u.wallet?.creditPoints ?? 100),
      approvedTasksCount: u._count.taskProgress,
      referralsCount: isMiniAdmin ? 0 : u._count.referrals,
    }));

    if (isMiniAdmin) {
      // Exclude users who graduated Level 1 (>= 10 tasks approved)
      formattedUsers = formattedUsers.filter((u) => (u.approvedTasksCount ?? 0) < 10);
    }

    res.json({
      users: formattedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/level-approvals', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const search = (req.query.search as string || '').trim();
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { referralCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total, allLevels] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          referralCode: true,
          accountStatus: true,
          createdAt: true,
          wallet: {
            select: {
              availableBalance: true,
              creditPoints: true,
            },
          },
          levelUnlocks: {
            select: {
              levelNumber: true,
              isApproved: true,
            },
          },
          taskProgress: {
            where: { status: 'APPROVED' },
            select: {
              task: {
                select: { levelId: true, id: true },
              },
            },
          },
          submissions: {
            where: { status: 'APPROVED' },
            select: {
              task: {
                select: { levelId: true, id: true },
              },
            },
          },
          levelProgress: {
            select: {
              levelId: true,
              approvedTaskCount: true,
              completionStatus: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
      prisma.level.findMany({
        select: { id: true, levelNumber: true, requiredTaskCount: true },
        orderBy: { levelNumber: 'asc' },
      }),
    ]);

    const formattedUsers = users.map((u) => {
      const approvedByLevel = new Map<string, Set<string>>();
      for (const p of u.taskProgress) {
        if (p.task?.levelId && p.task?.id) {
          if (!approvedByLevel.has(p.task.levelId)) approvedByLevel.set(p.task.levelId, new Set());
          approvedByLevel.get(p.task.levelId)!.add(p.task.id);
        }
      }
      for (const s of u.submissions) {
        if (s.task?.levelId && s.task?.id) {
          if (!approvedByLevel.has(s.task.levelId)) approvedByLevel.set(s.task.levelId, new Set());
          approvedByLevel.get(s.task.levelId)!.add(s.task.id);
        }
      }

      const lpMap = new Map(u.levelProgress.map((lp) => [lp.levelId, lp]));
      let completedLevels = 0;
      let level4Completed = false;

      for (const lvl of allLevels) {
        const set = approvedByLevel.get(lvl.id);
        const lp = lpMap.get(lvl.id);
        const approvedCount = Math.max(set ? set.size : 0, lp?.approvedTaskCount || 0);
        const isCompleted =
          lvl.levelNumber === 4
            ? approvedCount >= 1
            : approvedCount >= (lvl.requiredTaskCount || 10) || lp?.completionStatus === 'COMPLETED';

        if (isCompleted) {
          completedLevels = Math.max(completedLevels, lvl.levelNumber);
          if (lvl.levelNumber === 4) level4Completed = true;
        }
      }

      const approvalsMap: Record<number, boolean> = {};
      for (let i = 5; i <= 10; i++) {
        const found = u.levelUnlocks.find((ul) => ul.levelNumber === i);
        approvalsMap[i] = Boolean(found?.isApproved);
      }

      const currentLevel = Math.min(10, completedLevels + 1);

      return {
        id: u.id,
        name: u.name,
        phone: u.phone,
        referralCode: u.referralCode,
        accountStatus: u.accountStatus,
        createdAt: u.createdAt,
        walletBalance: u.wallet?.availableBalance || 0,
        creditPoints: u.wallet?.creditPoints ?? 100,
        currentLevel,
        level4Completed,
        approvals: approvalsMap,
      };
    });

    res.json({
      users: formattedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/level-approvals/toggle', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const { userId, levelNumber, isApproved } = req.body;
    const lvlNum = parseInt(levelNumber, 10);
    if (!userId || isNaN(lvlNum) || lvlNum < 5 || lvlNum > 10) {
      return res.status(400).json({ error: 'Valid userId and levelNumber between 5 and 10 are required.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const unlock = await prisma.userLevelUnlock.upsert({
      where: {
        userId_levelNumber: {
          userId,
          levelNumber: lvlNum,
        },
      },
      update: {
        isApproved: Boolean(isApproved),
        approvedAt: new Date(),
      },
      create: {
        userId,
        levelNumber: lvlNum,
        isApproved: Boolean(isApproved),
        approvedAt: new Date(),
      },
    });

    try {
      await prisma.adminAuditLog.create({
        data: {
          adminId: req.admin?.id,
          adminUsername: req.admin?.username || 'admin',
          action: isApproved ? 'LEVEL_UNLOCKED' : 'LEVEL_LOCKED',
          entityType: 'USER_LEVEL_UNLOCK',
          entityId: `${userId}_L${lvlNum}`,
          newState: JSON.stringify({ userId, levelNumber: lvlNum, isApproved: Boolean(isApproved) }),
          reason: `Admin ${isApproved ? 'unlocked' : 'locked'} Level ${lvlNum} for member ${user.name} (${user.phone})`,
        },
      });
    } catch (auditErr) {
      console.warn('Audit log write error:', auditErr);
    }

    res.json({
      success: true,
      unlock,
      message: `Level ${lvlNum} ${isApproved ? 'unlocked' : 'locked'} successfully for ${user.name}.`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/level-approvals/batch', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const { userId, levelNumbers, isApproved } = req.body;
    if (!userId || !Array.isArray(levelNumbers) || levelNumbers.length === 0) {
      return res.status(400).json({ error: 'Valid userId and levelNumbers array required.' });
    }

    const validLevels = levelNumbers.map((n: any) => parseInt(n, 10)).filter((n) => n >= 5 && n <= 10);
    if (validLevels.length === 0) {
      return res.status(400).json({ error: 'At least one level between 5 and 10 must be specified.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await Promise.all(
      validLevels.map((lvl) =>
        prisma.userLevelUnlock.upsert({
          where: {
            userId_levelNumber: {
              userId,
              levelNumber: lvl,
            },
          },
          update: {
            isApproved: Boolean(isApproved),
            approvedAt: new Date(),
          },
          create: {
            userId,
            levelNumber: lvl,
            isApproved: Boolean(isApproved),
            approvedAt: new Date(),
          },
        })
      )
    );

    try {
      await prisma.adminAuditLog.create({
        data: {
          adminId: req.admin?.id,
          adminUsername: req.admin?.username || 'admin',
          action: isApproved ? 'LEVELS_BATCH_UNLOCKED' : 'LEVELS_BATCH_LOCKED',
          entityType: 'USER_LEVEL_UNLOCK',
          entityId: userId,
          newState: JSON.stringify({ userId, levels: validLevels, isApproved: Boolean(isApproved) }),
          reason: `Admin ${isApproved ? 'unlocked' : 'locked'} Levels [${validLevels.join(', ')}] for member ${user.name}`,
        },
      });
    } catch (auditErr) {
      console.warn('Audit log write error:', auditErr);
    }

    res.json({
      success: true,
      message: `Levels [${validLevels.join(', ')}] ${isApproved ? 'unlocked' : 'locked'} successfully for ${user.name}.`,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:userId', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    let user: any;
    try {
      user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          wallet: true,
          referredBy: { select: { id: true, name: true, phone: true } },
          levelProgress: { include: { level: true } },
          taskProgress: {
            include: { task: { include: { level: true } } },
            orderBy: { createdAt: 'desc' },
          },
          depositRequests: { orderBy: { createdAt: 'desc' }, take: 50 },
          withdrawalRequests: { orderBy: { createdAt: 'desc' }, take: 50 },
          transactions: { orderBy: { createdAt: 'desc' }, take: 50 },
          spinEntitlements: { include: { assignedPrize: true } },
          spinHistories: { include: { prize: true }, orderBy: { createdAt: 'desc' }, take: 50 },
          submissions: { include: { task: true }, orderBy: { createdAt: 'desc' }, take: 20 },
        },
      });
    } catch (err: any) {
      if (String(err?.message).includes('isWithdrawalLocked') || String(err?.message).includes('column')) {
        await ensureUserWithdrawalColumns(prisma);
        user = await prisma.user.findUnique({
          where: { id: userId },
          include: {
            wallet: true,
            referredBy: { select: { id: true, name: true, phone: true } },
            levelProgress: { include: { level: true } },
            taskProgress: {
              include: { task: { include: { level: true } } },
              orderBy: { createdAt: 'desc' },
            },
            depositRequests: { orderBy: { createdAt: 'desc' }, take: 50 },
            withdrawalRequests: { orderBy: { createdAt: 'desc' }, take: 50 },
            transactions: { orderBy: { createdAt: 'desc' }, take: 50 },
            spinEntitlements: { include: { assignedPrize: true } },
            spinHistories: { include: { prize: true }, orderBy: { createdAt: 'desc' }, take: 50 },
            submissions: { include: { task: true }, orderBy: { createdAt: 'desc' }, take: 20 },
          },
        });
      } else {
        throw err;
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    if (isMiniAdmin) {
      const hasHigherLevelApproved = user.taskProgress?.some(
        (tp: any) => tp.status === 'APPROVED' && (tp.task?.level?.levelNumber ?? 1) > 1
      );
      const approvedCount = user.taskProgress?.filter((tp: any) => tp.status === 'APPROVED').length || 0;
      if (hasHigherLevelApproved || approvedCount >= 10) {
        return res.status(403).json({ error: 'Access Denied: Mini Admins can only view and manage Level 1 users' });
      }

      // Sanitize financial records for Mini Admin
      user.depositRequests = [];
      user.withdrawalRequests = [];
      user.transactions = [];
      user.spinEntitlements = [];
      user.spinHistories = [];
    }

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:userId/status', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    const { status, reason } = z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED']),
      reason: z.string().optional(),
    }).parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        taskProgress: {
          where: { status: 'APPROVED' },
          include: { task: { include: { level: true } } },
        },
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    if (isMiniAdmin) {
      const hasHigherLevelApproved = user.taskProgress?.some(
        (tp: any) => (tp.task?.level?.levelNumber ?? 1) > 1
      );
      if (hasHigherLevelApproved || (user.taskProgress?.length || 0) >= 10) {
        return res.status(403).json({ error: 'Access Denied: Mini Admins can only manage Level 1 users' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { accountStatus: status },
      select: {
        id: true,
        name: true,
        phone: true,
        referralCode: true,
        accountStatus: true,
        isWithdrawalLocked: true,
        withdrawalLockReason: true,
        updatedAt: true,
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: status === 'ACTIVE' ? 'USER_REACTIVATED' : 'USER_SUSPENDED',
      entityType: 'User',
      entityId: user.id,
      previousState: { accountStatus: user.accountStatus },
      newState: { accountStatus: status },
      reason,
      ipAddress: req.ip,
    });

    // Notify user's active session without page reload
    sendUserLiveCommand(userId, 'user_updated', { accountStatus: status });

    res.json({ message: `User status updated to ${status}`, user: updated });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:userId/withdrawal-lock', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    const { isLocked, reason } = z.object({
      isLocked: z.boolean(),
      reason: z.string().optional(),
    }).parse(req.body);

    if (isLocked && (!reason || !reason.trim())) {
      return res.status(400).json({ error: 'Admin must provide a reason when locking withdrawals for a user.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const trimmedReason = isLocked ? reason!.trim() : null;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        isWithdrawalLocked: isLocked,
        withdrawalLockReason: trimmedReason,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        referralCode: true,
        accountStatus: true,
        isWithdrawalLocked: true,
        withdrawalLockReason: true,
        updatedAt: true,
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: isLocked ? 'USER_WITHDRAWAL_LOCKED' : 'USER_WITHDRAWAL_UNLOCKED',
      entityType: 'User',
      entityId: user.id,
      previousState: {
        isWithdrawalLocked: user.isWithdrawalLocked,
        withdrawalLockReason: user.withdrawalLockReason,
      },
      newState: {
        isWithdrawalLocked: isLocked,
        withdrawalLockReason: trimmedReason,
      },
      reason: isLocked ? trimmedReason! : 'Withdrawals unlocked by administrator',
      ipAddress: req.ip,
    });

    // Notify user's active session without page reload
    sendUserLiveCommand(userId, 'wallet', {
      isWithdrawalLocked: isLocked,
      withdrawalLockReason: trimmedReason,
    });

    res.json({
      message: isLocked
        ? `Withdrawal locked for ${updated.name}. Reason: ${trimmedReason}`
        : `Withdrawal unlocked for ${updated.name}.`,
      user: updated,
    });
  } catch (err) {
    next(err);
  }
});

// Update specific fields of a single user (only modified fields are sent and updated)
router.patch('/users/:userId', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    const schema = z.object({
      name: z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
      phone: z.string().trim().min(5, 'Phone must be at least 5 characters').optional(),
      accountStatus: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
      isWithdrawalLocked: z.boolean().optional(),
      withdrawalLockReason: z.string().nullable().optional(),
      reason: z.string().optional(),
    });
    const parsed = schema.parse(req.body);
    const { reason, ...fieldsToUpdate } = parsed;

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, accountStatus: true, referralCode: true, isWithdrawalLocked: true, withdrawalLockReason: true },
    });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only include actually changed fields in the Prisma/database update
    const updateData: Record<string, any> = {};
    const changedFields: Record<string, any> = {};
    const previousFields: Record<string, any> = {};

    for (const [key, val] of Object.entries(fieldsToUpdate)) {
      if (val !== undefined && (existingUser as any)[key] !== val) {
        updateData[key] = val;
        changedFields[key] = val;
        previousFields[key] = (existingUser as any)[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.json({
        message: 'No changes detected. User profile is already up to date.',
        user: existingUser,
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        phone: true,
        referralCode: true,
        accountStatus: true,
        isWithdrawalLocked: true,
        withdrawalLockReason: true,
        updatedAt: true,
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'ADMIN_UPDATE_USER_FIELDS',
      entityType: 'User',
      entityId: userId,
      previousState: previousFields,
      newState: changedFields,
      reason: reason || 'Admin updated user profile fields',
      ipAddress: req.ip,
    });

    // Notify user's active session without page reload
    sendUserLiveCommand(userId, 'user_updated', changedFields);

    res.json({
      message: 'User updated successfully',
      user: updatedUser,
    });
  } catch (err) {
    next(err);
  }
});

// Fetch summary for a single user entity without reloading all users or unrelated data
router.get('/users/:userId/summary', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        referralCode: true,
        referredById: true,
        accountStatus: true,
        isWithdrawalLocked: true,
        withdrawalLockReason: true,
        createdAt: true,
        wallet: {
          select: {
            availableBalance: true,
            creditPoints: true,
          },
        },
        _count: {
          select: {
            taskProgress: { where: { status: 'APPROVED' } },
            referrals: true,
          },
        },
      },
    });

    if (!u) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: u.id,
        name: u.name,
        phone: u.phone,
        referralCode: u.referralCode,
        referredById: u.referredById,
        accountStatus: u.accountStatus,
        isWithdrawalLocked: u.isWithdrawalLocked,
        withdrawalLockReason: u.withdrawalLockReason,
        createdAt: u.createdAt,
        walletBalance: u.wallet?.availableBalance || 0,
        creditPoints: u.wallet?.creditPoints ?? 100,
        approvedTasksCount: u._count.taskProgress,
        referralsCount: u._count.referrals,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:userId/reset-password', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    const { temporaryPassword, requireChangeOnLogin, reason } = z.object({
      temporaryPassword: z.string().min(6, 'Temporary password must be at least 6 characters'),
      requireChangeOnLogin: z.boolean().default(true),
      reason: z
        .string()
        .optional()
        .transform((v) => (v && v.trim() ? v.trim() : 'Admin Password Reset')),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: requireChangeOnLogin,
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'ADMIN_RESET_USER_PASSWORD',
      entityType: 'User',
      entityId: user.id,
      reason,
      ipAddress: req.ip,
    });

    await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Security Notice: Password Reset by Admin 🔐',
        message: 'Your account password has been reset by an administrator. Please log in with your temporary credentials.',
        notificationType: 'PASSWORD_RESET',
      },
    });

    res.json({ message: 'User password reset successfully.' });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:userId/adjust-balance', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    const { amount, actionType, reason, notes } = z.object({
      amount: z.number().positive('Adjustment amount must be positive'),
      actionType: z.enum(['CREDIT', 'DEBIT']),
      reason: z
        .string()
        .optional()
        .transform((v) => (v && v.trim() ? v.trim() : 'Admin Balance Adjustment')),
      notes: z.string().optional(),
    }).parse(req.body);

    const user: any = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentBalance = user.wallet?.availableBalance || 0;
    if (actionType === 'DEBIT' && currentBalance < amount) {
      return res.status(400).json({
        error: `Cannot debit PKR ${amount.toLocaleString()}. Current balance is only PKR ${currentBalance.toLocaleString()}. Negative balance is not allowed.`,
      });
    }

    const finalAmount = actionType === 'CREDIT' ? amount : -amount;
    const newBalance = currentBalance + finalAmount;

    const result = await prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: {
          availableBalance: newBalance,
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          transactionType: actionType === 'CREDIT' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
          amount: finalAmount,
          currency: 'PKR',
          status: 'COMPLETED',
          actorId: req.admin!.id,
          actorName: req.admin!.username,
          reason,
          notes,
        },
      });

      await tx.notification.create({
        data: {
          userId,
          title: `Account Balance Adjusted: ${actionType === 'CREDIT' ? '+' : '-'}PKR ${amount.toLocaleString()} 💰`,
          message: `Your balance was adjusted by administration. Reason: ${reason}`,
          notificationType: 'SYSTEM',
        },
      });

      return { wallet: updatedWallet, transaction };
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: actionType === 'CREDIT' ? 'ADMIN_BALANCE_CREDIT' : 'ADMIN_BALANCE_DEBIT',
      entityType: 'Wallet',
      entityId: result.wallet.id,
      previousState: { availableBalance: currentBalance },
      newState: { availableBalance: newBalance, adjustment: finalAmount },
      reason,
      ipAddress: req.ip,
    });

    // Notify user's active session without page reload
    sendUserLiveCommand(userId, 'wallet', { availableBalance: newBalance });

    res.json({
      message: `Successfully adjusted balance by ${actionType === 'CREDIT' ? '+' : '-'}PKR ${amount.toLocaleString()}`,
      wallet: {
        id: result.wallet.id,
        userId: result.wallet.userId,
        availableBalance: result.wallet.availableBalance,
        creditPoints: result.wallet.creditPoints,
      },
      transaction: result.transaction,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:userId/adjust-credit-points', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const userId = req.params.userId as string;
    const { points, actionType, reason, notes } = z.object({
      points: z.number().int().positive('Adjustment points must be a positive integer'),
      actionType: z.enum(['ADD', 'DEDUCT']),
      reason: z
        .string()
        .optional()
        .transform((v) => (v && v.trim() ? v.trim() : 'Admin Credit Points Adjustment')),
      notes: z.string().optional(),
    }).parse(req.body);

    const user: any = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentPoints = user.wallet?.creditPoints ?? 100;
    if (actionType === 'DEDUCT' && currentPoints < points) {
      return res.status(400).json({
        error: `Cannot deduct ${points} credit points. Current balance is only ${currentPoints} CPs. Negative credit points are not allowed.`,
      });
    }

    const finalPointsDelta = actionType === 'ADD' ? points : -points;
    const newPoints = currentPoints + finalPointsDelta;

    const result = await prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.upsert({
        where: { userId },
        update: {
          creditPoints: newPoints,
        },
        create: {
          userId,
          availableBalance: 0,
          pendingBalance: 0,
          totalEarned: 0,
          totalDeposited: 0,
          creditPoints: newPoints,
        },
      });

      await tx.notification.create({
        data: {
          userId,
          title: `Credit Points Adjusted: ${actionType === 'ADD' ? '+' : '-'}${points} CPs 🎯`,
          message: `Your credit points balance was adjusted by administration. Reason: ${reason}. New balance: ${newPoints} CPs.`,
          notificationType: 'SYSTEM',
        },
      });

      return { wallet: updatedWallet };
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: actionType === 'ADD' ? 'ADMIN_CREDIT_POINTS_ADD' : 'ADMIN_CREDIT_POINTS_DEDUCT',
      entityType: 'Wallet',
      entityId: result.wallet.id,
      previousState: { creditPoints: currentPoints },
      newState: { creditPoints: newPoints, adjustment: finalPointsDelta },
      reason,
      ipAddress: req.ip,
    });

    // Notify user's active session without page reload
    sendUserLiveCommand(userId, 'wallet', { creditPoints: newPoints });

    res.json({
      message: `Successfully ${actionType === 'ADD' ? 'added' : 'deducted'} ${points} credit points. New balance: ${newPoints} CPs.`,
      creditPoints: newPoints,
      wallet: {
        id: result.wallet.id,
        userId: result.wallet.userId,
        creditPoints: result.wallet.creditPoints,
        availableBalance: result.wallet.availableBalance,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 5. TASK MANAGEMENT & EDITING MODAL
// ==========================================

router.get('/tasks', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    const levelNumber = isMiniAdmin ? 1 : (req.query.level ? parseInt(req.query.level as string, 10) : undefined);
    const search = (req.query.search as string || '').trim();

    const where: any = {};
    if (levelNumber) {
      where.level = { levelNumber };
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { taskType: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        level: true,
        _count: {
          select: {
            submissions: { where: { status: 'PENDING' } },
          },
        },
      },
      orderBy: [
        { level: { levelNumber: 'asc' } },
        { taskNumber: 'asc' },
      ],
    });

    res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

router.put('/tasks/:taskId', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const taskId = req.params.taskId as string;
    const schema = z.object({
      title: z.string().min(2, 'Task title is required'),
      description: z.string().min(5, 'Task description is required'),
      taskType: z.string().min(2, 'Task type is required'),
      rewardAmount: z.number().nonnegative('Reward must be 0 or positive'),
      isPaid: z.boolean(),
      unlockFee: z.number().nonnegative('Unlock fee cannot be negative'),
      protectedUrl: z.string().optional().nullable(),
      instructions: z.string().min(5, 'Instructions are required'),
      lockMessage: z.string().min(5, 'Lock message is required'),
      submissionInstructions: z.string().min(5, 'Submission instructions are required'),
      externalContact: z.string().optional().nullable(),
      requiresAdminApproval: z.boolean(),
      status: z.enum(['ACTIVE', 'DISABLED']),
    });

    const validated = schema.parse(req.body);

    const existingTask = await prisma.task.findUnique({ where: { id: taskId } });
    if (!existingTask) return res.status(404).json({ error: 'Task not found' });

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...validated,
        unlockFee: validated.isPaid ? validated.unlockFee : 0,
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'TASK_UPDATED',
      entityType: 'Task',
      entityId: taskId,
      previousState: existingTask,
      newState: updatedTask,
      ipAddress: req.ip,
    });

    res.json({ message: 'Task configuration updated successfully', task: updatedTask });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 6. LEVEL MANAGEMENT
// ==========================================

router.get('/levels', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    const levels = await prisma.level.findMany({
      where: isMiniAdmin ? { levelNumber: 1 } : undefined,
      orderBy: { levelNumber: 'asc' },
      include: {
        tasks: { orderBy: { taskNumber: 'asc' } },
        _count: { select: { userProgress: true } },
      },
    });

    const notices = await getAllLevelWithdrawalNotices();
    const levelsWithNotices = levels.map((lvl) => ({
      ...lvl,
      withdrawalNotice:
        notices[lvl.levelNumber] ||
        DEFAULT_LEVEL_WITHDRAWAL_NOTICES[lvl.levelNumber] ||
        `Complete Level ${lvl.levelNumber} to unlock the withdrawal panel for Level ${lvl.levelNumber} reward`,
    }));

    res.json({ levels: levelsWithNotices });
  } catch (err) {
    next(err);
  }
});

router.put('/levels/:levelId', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const levelId = req.params.levelId as string;
    const schema = z.object({
      title: z.string().min(2),
      description: z.string().min(5),
      completionReward: z.number().nonnegative().optional().default(0),
      status: z.enum(['ACTIVE', 'DISABLED']),
      withdrawalNotice: z.string().optional().nullable(),
    });

    const validated = schema.parse(req.body);
    const existing = await prisma.level.findUnique({ where: { id: levelId } });
    if (!existing) return res.status(404).json({ error: 'Level not found' });

    if (validated.withdrawalNotice !== undefined && validated.withdrawalNotice !== null) {
      await setLevelWithdrawalNotice(existing.levelNumber, validated.withdrawalNotice);
    }

    const { withdrawalNotice, ...levelUpdateData } = validated;

    const updated = await prisma.level.update({
      where: { id: levelId },
      data: levelUpdateData,
    });

    const currentNotice = await getLevelWithdrawalNotice(existing.levelNumber);

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'LEVEL_UPDATED',
      entityType: 'Level',
      entityId: levelId,
      previousState: existing,
      newState: { ...updated, withdrawalNotice: currentNotice },
      ipAddress: req.ip,
    });

    res.json({
      message: 'Level updated successfully',
      level: { ...updated, withdrawalNotice: currentNotice },
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 7. TASK SUBMISSION VERIFICATION
// ==========================================

router.get('/submissions', requireAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    const status = (req.query.status as string || '').trim();
    const search = (req.query.search as string || '').trim();
    const levelNumber = isMiniAdmin ? 1 : (req.query.level ? parseInt(req.query.level as string, 10) : undefined);
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (levelNumber) where.task = { level: { levelNumber } };
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search } } },
            { user: { referralCode: { contains: search, mode: 'insensitive' } } },
            { user: { id: { contains: search } } },
            { id: { contains: search } },
          ],
        },
      ];
    }

    const [submissions, total] = await Promise.all([
      prisma.taskSubmission.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, phone: true } },
          task: { include: { level: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.taskSubmission.count({ where }),
    ]);

    res.json({
      submissions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

async function executeReviewSubmissionCore(params: {
  submissionId: string;
  action: 'APPROVE' | 'REJECT';
  admin: { id: string; username: string };
  reviewNotes?: string;
  rejectionReason?: string;
  ipAddress?: string;
}) {
  const { submissionId, action, admin, reviewNotes, rejectionReason, ipAddress } = params;

  const submission: any = await prisma.taskSubmission.findUnique({
    where: { id: submissionId },
    include: {
      task: { include: { level: true } },
      user: true,
    },
  });

  if (!submission) throw new Error('Submission not found');
  if (submission.status !== 'PENDING') {
    throw new Error(`This submission has already been reviewed (Status: ${submission.status})`);
  }

  const { user, task } = submission;

  if (action === 'APPROVE') {
    const taskRewardToAdd = Number(task.rewardAmount || 0);

    const result = await prisma.$transaction(async (tx) => {
      // Update submission
      const updatedSub = await tx.taskSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'APPROVED',
          reviewerId: admin.id,
          reviewerName: admin.username,
          reviewNotes: reviewNotes || null,
        },
      });

      // Check if task was ALREADY approved for this user before incrementing
      const existingProgress = await tx.userTaskProgress.findUnique({
        where: { userId_taskId: { userId: user.id, taskId: task.id } },
      });
      const wasAlreadyApproved = existingProgress?.status === 'APPROVED';

      // Update UserTaskProgress
      await tx.userTaskProgress.upsert({
        where: { userId_taskId: { userId: user.id, taskId: task.id } },
        update: {
          status: 'APPROVED',
          approvedAt: new Date(),
          reviewerId: admin.id,
        },
        create: {
          userId: user.id,
          taskId: task.id,
          status: 'APPROVED',
          approvedAt: new Date(),
          reviewerId: admin.id,
        },
      });

      // Resolve any other pending submissions for this task
      await tx.taskSubmission.updateMany({
        where: {
          userId: user.id,
          taskId: task.id,
          status: 'PENDING',
          id: { not: submissionId },
        },
        data: {
          status: 'APPROVED',
          reviewerId: admin.id,
          reviewerName: admin.username,
          reviewNotes: 'Auto-resolved with task approval',
        },
      });

      // Credit wallet (PKR reward only; credit points are never changed by task completion)
      let updatedWallet: any = await tx.wallet.findUnique({ where: { userId: user.id } });

      if (!wasAlreadyApproved && taskRewardToAdd > 0) {
        updatedWallet = await tx.wallet.update({
          where: { userId: user.id },
          data: {
            availableBalance: { increment: taskRewardToAdd },
            totalEarned: { increment: taskRewardToAdd },
          },
        });

        await tx.walletTransaction.create({
          data: {
            userId: user.id,
            transactionType: 'TASK_REWARD',
            amount: taskRewardToAdd,
            currency: 'PKR',
            status: 'COMPLETED',
            relatedEntityId: task.id,
            actorId: admin.id,
            actorName: admin.username,
            reason: `Task #${task.taskNumber} (${task.title}) Reward Credited`,
            notes: `Task reward of PKR ${taskRewardToAdd.toLocaleString()} credited upon admin approval. Account balance updated to PKR ${updatedWallet.availableBalance.toLocaleString()}`,
          },
        });
      }

      // Notification
      const rewardNotice = taskRewardToAdd > 0 ? ` + PKR ${taskRewardToAdd.toLocaleString()} Balance` : '';
      await tx.notification.create({
        data: {
          userId: user.id,
          title: `Task Approved!${rewardNotice} 🎉`,
          message: `Your task "${task.title}" was approved by administrator ${admin.username}.${taskRewardToAdd > 0 ? ` PKR ${taskRewardToAdd.toLocaleString()} has been directly credited to your account balance!` : ''} The next sequential task is now unlocked.`,
          notificationType: 'TASK_STATUS',
        },
      });

      // Level Completion Milestone: Trigger a Free Spin entitlement strictly when ALL tasks in the level are approved
      const requiredCount = task.level.requiredTaskCount || 10;
      const approvedTasksInLevel = await tx.taskSubmission.count({
        where: {
          userId: user.id,
          task: { levelId: task.levelId },
          status: 'APPROVED',
        },
      });
      const isLevelFullyCompleted = approvedTasksInLevel >= requiredCount;
      if (isLevelFullyCompleted) {
        const milestoneReason = `Level ${task.level.levelNumber} Completion Free Spin`;
        const existingEntitlement = await tx.userSpinEntitlement.findFirst({
          where: {
            userId: user.id,
            levelNumber: task.level.levelNumber,
          },
        });

        if (!existingEntitlement) {
          await tx.userSpinEntitlement.create({
            data: {
              userId: user.id,
              levelNumber: task.level.levelNumber,
              taskNumber: requiredCount,
              triggerReason: milestoneReason,
              totalSpins: 1,
              remainingSpins: 1,
              isEligible: false,
              requiresAdminReview: true,
              adminReviewed: false,
              assignedPrizeId: null,
            },
          });

          await tx.notification.create({
            data: {
              userId: user.id,
              title: `Level ${task.level.levelNumber} Completed! Free Spin Earned! 🎡`,
              message: `Congratulations! Completing Level ${task.level.levelNumber} earned you a Free Royal Spin! Your entitlement is submitted to administration to assign your reward.`,
              notificationType: 'SPIN_REWARD',
            },
          });
        }
      }

      return { updatedSub, updatedWallet };
    });

    const { updatedSub, updatedWallet } = result;

    // Parallelize level progression & referral qualification queries
    await Promise.all([
      taskProgressionService.updateLevelProgress(user.id, task.levelId),
      affiliateService.checkAndQualifyReferral(user.id, 'TASK_APPROVED'),
    ]);

    // Dispatch non-blocking audit logging & live WebSocket events asynchronously
    logAdminAction({
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'TASK_SUBMISSION_APPROVED',
      entityType: 'TaskSubmission',
      entityId: submissionId,
      newState: {
        status: 'APPROVED',
        rewardAmount: task.rewardAmount,
        newBalance: updatedWallet.availableBalance,
      },
      reason: reviewNotes,
      ipAddress,
    }).catch((e) => console.error('Admin audit log error:', e));

    sendUserLiveCommand(user.id, 'wallet', {
      availableBalance: updatedWallet.availableBalance,
      totalEarned: updatedWallet.totalEarned,
    });
    sendUserLiveCommand(user.id, 'task', { submissionId, taskId: task.id, status: 'APPROVED' });
    sendUserLiveCommand(user.id, 'refresh', { type: 'TASK_APPROVED' });

    return { updatedSub, updatedWallet };
  } else {
    // REJECT
    const updatedSub = await prisma.$transaction(async (tx) => {
      const sub = await tx.taskSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'REJECTED',
          reviewerId: admin.id,
          reviewerName: admin.username,
          reviewNotes: reviewNotes || null,
          rejectionReason: rejectionReason || 'Verification requirements not satisfied',
        },
      });

      await tx.userTaskProgress.upsert({
        where: { userId_taskId: { userId: user.id, taskId: task.id } },
        update: {
          status: 'REJECTED',
          rejectionReason: rejectionReason || 'Verification requirements not satisfied',
        },
        create: {
          userId: user.id,
          taskId: task.id,
          status: 'REJECTED',
          rejectionReason: rejectionReason || 'Verification requirements not satisfied',
        },
      });

      await tx.notification.create({
        data: {
          userId: user.id,
          title: `Task Submission Rejected ❌`,
          message: `Your submission for "${task.title}" was rejected. Reason: ${rejectionReason || 'Please resubmit with clear proof.'}`,
          notificationType: 'TASK_STATUS',
        },
      });

      return sub;
    });

    logAdminAction({
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'TASK_SUBMISSION_REJECTED',
      entityType: 'TaskSubmission',
      entityId: submissionId,
      newState: { status: 'REJECTED', rejectionReason },
      reason: reviewNotes,
      ipAddress,
    }).catch((e) => console.error('Admin audit log error:', e));

    sendUserLiveCommand(user.id, 'task', { submissionId, taskId: task.id, status: 'REJECTED' });
    sendUserLiveCommand(user.id, 'refresh', { type: 'TASK_REJECTED' });

    return { updatedSub };
  }
}

router.put('/submissions/:submissionId/review', requireAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const submissionId = req.params.submissionId as string;
    const { action, reviewNotes, rejectionReason } = z.object({
      action: z.enum(['APPROVE', 'REJECT']),
      reviewNotes: z.string().optional(),
      rejectionReason: z.string().optional(),
    }).parse(req.body);

    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    if (isMiniAdmin) {
      const targetSub = await prisma.taskSubmission.findUnique({
        where: { id: submissionId },
        select: { task: { select: { level: { select: { levelNumber: true } } } } },
      });
      if (!targetSub || targetSub.task?.level?.levelNumber !== 1) {
        return res.status(403).json({ error: 'Access Denied: Mini Admins can only review Level 1 task submissions' });
      }
    }

    const result = await executeReviewSubmissionCore({
      submissionId,
      action,
      admin: { id: req.admin!.id, username: req.admin!.username },
      reviewNotes,
      rejectionReason,
      ipAddress: req.ip,
    });

    if (action === 'APPROVE') {
      res.json({ message: 'Task approved and reward credited successfully!', submission: result.updatedSub, wallet: result.updatedWallet });
    } else {
      res.json({ message: 'Task submission rejected.', submission: result.updatedSub });
    }
  } catch (err) {
    next(err);
  }
});

router.post('/submissions/batch-review', requireAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const { submissionIds, action, reviewNotes, rejectionReason } = z.object({
      submissionIds: z.array(z.string()).min(1, 'Select at least one submission'),
      action: z.enum(['APPROVE', 'REJECT']),
      reviewNotes: z.string().optional(),
      rejectionReason: z.string().optional(),
    }).parse(req.body);

    const isMiniAdmin = req.admin?.role === 'MINI_ADMIN';
    if (isMiniAdmin) {
      const nonLevel1Count = await prisma.taskSubmission.count({
        where: {
          id: { in: submissionIds },
          task: { level: { levelNumber: { not: 1 } } },
        },
      });
      if (nonLevel1Count > 0) {
        return res.status(403).json({ error: 'Access Denied: Mini Admins can only review Level 1 task submissions' });
      }
    }

    const results: { id: string; success: boolean; error?: string }[] = [];

    // Process concurrent batches of up to 10
    const chunkSize = 10;
    for (let i = 0; i < submissionIds.length; i += chunkSize) {
      const chunk = submissionIds.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (id) => {
          try {
            await executeReviewSubmissionCore({
              submissionId: id,
              action,
              admin: { id: req.admin!.id, username: req.admin!.username },
              reviewNotes,
              rejectionReason,
              ipAddress: req.ip,
            });
            results.push({ id, success: true });
          } catch (err: any) {
            results.push({ id, success: false, error: err.message });
          }
        })
      );
    }

    const successCount = results.filter((r) => r.success).length;
    res.json({
      message: `Batch complete: ${successCount} of ${submissionIds.length} submissions ${action.toLowerCase()}d successfully.`,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 8. DEPOSIT MANAGEMENT
// ==========================================

router.get('/deposits', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const status = (req.query.status as string || '').trim();
    const search = (req.query.search as string || '').trim();
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search } } },
            { user: { referralCode: { contains: search, mode: 'insensitive' } } },
            { user: { id: { contains: search } } },
            { transactionReference: { contains: search, mode: 'insensitive' } },
            { id: { contains: search } },
          ],
        },
      ];
    }

    const [deposits, total] = await Promise.all([
      prisma.depositRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.depositRequest.count({ where }),
    ]);

    res.json({
      deposits,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/deposits/:depositId/review', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const depositId = req.params.depositId as string;
    const { action, reviewNotes } = z.object({
      action: z.enum(['APPROVE', 'REJECT']),
      reviewNotes: z.string().optional(),
    }).parse(req.body);

    const deposit = await prisma.depositRequest.findUnique({
      where: { id: depositId },
      include: { user: true },
    });

    if (!deposit) return res.status(404).json({ error: 'Deposit request not found' });
    if (deposit.status !== 'PENDING') {
      return res.status(400).json({ error: `This deposit has already been reviewed (Status: ${deposit.status})` });
    }

    if (action === 'APPROVE') {
      // Atomic approval & wallet credit
      const result = await prisma.$transaction(async (tx) => {
        const updatedDep = await tx.depositRequest.update({
          where: { id: depositId },
          data: {
            status: 'APPROVED',
            reviewerId: req.admin!.id,
            reviewerName: req.admin!.username,
            reviewNotes: reviewNotes || null,
          },
        });

        // Credit availableBalance and totalDeposited
        await tx.wallet.update({
          where: { userId: deposit.userId },
          data: {
            availableBalance: { increment: deposit.amount },
            totalDeposited: { increment: deposit.amount },
          },
        });

        // Immutable ledger record
        await tx.walletTransaction.create({
          data: {
            userId: deposit.userId,
            transactionType: 'DEPOSIT_CREDIT',
            amount: deposit.amount,
            currency: 'PKR',
            status: 'COMPLETED',
            relatedEntityId: deposit.id,
            actorId: req.admin!.id,
            actorName: req.admin!.username,
            reason: `Deposit approved via ${deposit.paymentMethod} (Ref: ${deposit.transactionReference})`,
            notes: reviewNotes,
          },
        });

        // Notification
        const depositComment = reviewNotes?.trim() ? `\n\nAdmin Comment: ${reviewNotes.trim()}` : '';
        await tx.notification.create({
          data: {
            userId: deposit.userId,
            title: `Deposit Approved: PKR ${deposit.amount.toLocaleString()} ✅`,
            message: `Your deposit of PKR ${deposit.amount.toLocaleString()} has been approved and added to your available balance.${depositComment}`,
            notificationType: 'DEPOSIT_STATUS',
          },
        });

        return updatedDep;
      });

      await logAdminAction({
        adminId: req.admin!.id,
        adminUsername: req.admin!.username,
        action: 'DEPOSIT_APPROVED',
        entityType: 'DepositRequest',
        entityId: depositId,
        newState: { status: 'APPROVED', amount: deposit.amount },
        reason: reviewNotes,
        ipAddress: req.ip,
      });

      // Check and qualify referral if qualification criteria is deposit-based
      await affiliateService.checkAndQualifyReferral(deposit.userId, 'DEPOSIT_APPROVED');

      sendUserLiveCommand(deposit.userId, 'wallet', {
        type: 'DEPOSIT_APPROVED',
        depositId: deposit.id,
        amount: deposit.amount,
      });

      res.json({ message: `Deposit of PKR ${deposit.amount.toLocaleString()} approved and credited!`, deposit: result });
    } else {
      // REJECT
      const updatedDep = await prisma.$transaction(async (tx) => {
        const dep = await tx.depositRequest.update({
          where: { id: depositId },
          data: {
            status: 'REJECTED',
            reviewerId: req.admin!.id,
            reviewerName: req.admin!.username,
            reviewNotes: reviewNotes || 'Transaction details could not be verified',
          },
        });

        const depositRejectComment = reviewNotes?.trim() || 'Verification unconfirmed.';
        await tx.notification.create({
          data: {
            userId: deposit.userId,
            title: `Deposit Rejected ❌`,
            message: `Your deposit request for PKR ${deposit.amount.toLocaleString()} was rejected.\n\nAdmin Comment: ${depositRejectComment}`,
            notificationType: 'DEPOSIT_STATUS',
          },
        });

        return dep;
      });

      await logAdminAction({
        adminId: req.admin!.id,
        adminUsername: req.admin!.username,
        action: 'DEPOSIT_REJECTED',
        entityType: 'DepositRequest',
        entityId: depositId,
        newState: { status: 'REJECTED' },
        reason: reviewNotes,
        ipAddress: req.ip,
      });

      sendUserLiveCommand(deposit.userId, 'wallet', {
        type: 'DEPOSIT_REJECTED',
        depositId: deposit.id,
      });

      res.json({ message: 'Deposit request rejected.', deposit: updatedDep });
    }
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 9. WITHDRAWAL MANAGEMENT
// ==========================================

router.get('/withdrawals', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const approvalStatus = (req.query.approvalStatus as string || '').trim();
    const paymentStatus = (req.query.paymentStatus as string || '').trim();
    const search = (req.query.search as string || '').trim();
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search } } },
            { user: { referralCode: { contains: search, mode: 'insensitive' } } },
            { user: { id: { contains: search } } },
            { recipientAccount: { contains: search } },
            { recipientName: { contains: search, mode: 'insensitive' } },
            { payoutReference: { contains: search, mode: 'insensitive' } },
            { id: { contains: search } },
          ],
        },
      ];
    }

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.withdrawalRequest.count({ where }),
    ]);

    res.json({
      withdrawals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/withdrawals/:withdrawalId/review', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const withdrawalId = req.params.withdrawalId as string;
    const { action, reviewNotes } = z.object({
      action: z.enum(['APPROVE', 'REJECT']),
      reviewNotes: z.string().optional(),
    }).parse(req.body);

    const withdrawal = await prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      include: { user: true },
    });

    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (withdrawal.approvalStatus !== 'PENDING') {
      return res.status(400).json({ error: `Withdrawal has already been reviewed (Status: ${withdrawal.approvalStatus})` });
    }

    if (action === 'APPROVE') {
      const isLevel2 = Boolean(withdrawal.notes?.includes('[LEVEL_2_WITHDRAWAL]'));

      if (isLevel2) {
        const totalAmount = withdrawal.amount;
        const payoutAmount = Math.round(totalAmount * 0.10);
        const refundAmount = totalAmount - payoutAmount;

        const updated = await prisma.$transaction(async (tx) => {
          const reqRec = await tx.withdrawalRequest.update({
            where: { id: withdrawalId },
            data: {
              amount: payoutAmount,
              approvalStatus: 'APPROVED',
              paymentStatus: 'NOT_SENT',
              reviewerId: req.admin!.id,
              reviewerName: req.admin!.username,
              reviewNotes: reviewNotes || `Level 2 approval: 10% (PKR ${payoutAmount.toLocaleString()}) approved for payout, 90% (PKR ${refundAmount.toLocaleString()}) returned to wallet`,
              notes: `${withdrawal.notes || ''} | [L2_PROCESSED: payout=${payoutAmount}, refunded=${refundAmount}]`,
            },
          });

          // Return 90% from pendingBalance back to availableBalance
          await tx.wallet.update({
            where: { userId: withdrawal.userId },
            data: {
              pendingBalance: { decrement: refundAmount },
              availableBalance: { increment: refundAmount },
            },
          });

          await tx.walletTransaction.create({
            data: {
              userId: withdrawal.userId,
              transactionType: 'WITHDRAWAL_PARTIAL_REFUND',
              amount: refundAmount,
              currency: 'PKR',
              status: 'COMPLETED',
              relatedEntityId: withdrawal.id,
              actorId: req.admin!.id,
              actorName: req.admin!.username,
              reason: `90% account balance return for Level 2 withdrawal #${withdrawal.id.slice(-6)} (10% PKR ${payoutAmount.toLocaleString()} approved for payout)`,
              notes: reviewNotes,
            },
          });

          const l2Comment = reviewNotes?.trim() ? `\n\nAdmin Comment: ${reviewNotes.trim()}` : '';
          await tx.notification.create({
            data: {
              userId: withdrawal.userId,
              title: `Level 2 Withdrawal Approved! (10% Payout) ✅`,
              message: `Your Level 2 withdrawal has been approved! PKR ${payoutAmount.toLocaleString()} (10%) is approved for payout, and PKR ${refundAmount.toLocaleString()} (90%) has been restored to your account balance.${l2Comment}`,
              notificationType: 'WITHDRAWAL_STATUS',
            },
          });

          return reqRec;
        });

        await logAdminAction({
          adminId: req.admin!.id,
          adminUsername: req.admin!.username,
          action: 'WITHDRAWAL_APPROVED',
          entityType: 'WithdrawalRequest',
          entityId: withdrawalId,
          newState: { approvalStatus: 'APPROVED', paymentStatus: 'NOT_SENT', amount: payoutAmount },
          reason: `Level 2 withdrawal: 10% PKR ${payoutAmount} payout approved, 90% PKR ${refundAmount} refunded`,
          ipAddress: req.ip,
        });

        return res.json({
          message: `Level 2 withdrawal approved! PKR ${payoutAmount.toLocaleString()} (10%) approved for payout, and PKR ${refundAmount.toLocaleString()} (90%) returned to user wallet.`,
          withdrawal: updated,
        });
      }

      // Mark Approved (Payment remains NOT_SENT until admin actually sends funds)
      const updated = await prisma.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: {
          approvalStatus: 'APPROVED',
          paymentStatus: 'NOT_SENT',
          reviewerId: req.admin!.id,
          reviewerName: req.admin!.username,
          reviewNotes: reviewNotes || null,
        },
      });

      const withdrawApproveComment = reviewNotes?.trim() ? `\n\nAdmin Comment: ${reviewNotes.trim()}` : '';
      await prisma.notification.create({
        data: {
          userId: withdrawal.userId,
          title: `Withdrawal Approved! ✅`,
          message: `Your withdrawal of PKR ${withdrawal.amount.toLocaleString()} has been approved. Payment processing is underway.${withdrawApproveComment}`,
          notificationType: 'WITHDRAWAL_STATUS',
        },
      });

      await logAdminAction({
        adminId: req.admin!.id,
        adminUsername: req.admin!.username,
        action: 'WITHDRAWAL_APPROVED',
        entityType: 'WithdrawalRequest',
        entityId: withdrawalId,
        newState: { approvalStatus: 'APPROVED', paymentStatus: 'NOT_SENT' },
        reason: reviewNotes,
        ipAddress: req.ip,
      });

      res.json({ message: 'Withdrawal approved. Status is now Approved (Not Sent).', withdrawal: updated });
    } else {
      // REJECT: Release reserved balance back to available balance!
      const updated = await prisma.$transaction(async (tx) => {
        const reqRec = await tx.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            approvalStatus: 'REJECTED',
            paymentStatus: 'FAILED',
            reviewerId: req.admin!.id,
            reviewerName: req.admin!.username,
            reviewNotes: reviewNotes || 'Withdrawal rejected by administrator',
          },
        });

        // Release reserved funds back to available balance
        await tx.wallet.update({
          where: { userId: withdrawal.userId },
          data: {
            availableBalance: { increment: withdrawal.amount },
            pendingBalance: { decrement: withdrawal.amount },
          },
        });

        // Reversal ledger record
        await tx.walletTransaction.create({
          data: {
            userId: withdrawal.userId,
            transactionType: 'WITHDRAWAL_REVERSAL',
            amount: withdrawal.amount,
            currency: 'PKR',
            status: 'COMPLETED',
            relatedEntityId: withdrawal.id,
            actorId: req.admin!.id,
            actorName: req.admin!.username,
            reason: `Reservation refund for rejected withdrawal #${withdrawal.id.slice(-6)}`,
            notes: reviewNotes,
          },
        });

        const withdrawRejectComment = reviewNotes?.trim() || 'Withdrawal rejected by administrator.';
        await tx.notification.create({
          data: {
            userId: withdrawal.userId,
            title: `Withdrawal Rejected - Funds Restored 🔄`,
            message: `Your withdrawal of PKR ${withdrawal.amount.toLocaleString()} was rejected. Reserved funds have been restored to your available balance.\n\nAdmin Comment: ${withdrawRejectComment}`,
            notificationType: 'WITHDRAWAL_STATUS',
          },
        });

        return reqRec;
      });

      await logAdminAction({
        adminId: req.admin!.id,
        adminUsername: req.admin!.username,
        action: 'WITHDRAWAL_REJECTED',
        entityType: 'WithdrawalRequest',
        entityId: withdrawalId,
        newState: { approvalStatus: 'REJECTED' },
        reason: reviewNotes,
        ipAddress: req.ip,
      });

      res.json({ message: 'Withdrawal rejected and funds restored to user.', withdrawal: updated });
    }
  } catch (err) {
    next(err);
  }
});

router.put('/withdrawals/:withdrawalId/payout', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const withdrawalId = req.params.withdrawalId as string;
    const { payoutReference, reviewNotes } = z.object({
      payoutReference: z.string().min(2, 'Payout transaction reference / Trx ID is required'),
      reviewNotes: z.string().optional(),
    }).parse(req.body);

    const withdrawal = await prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      include: { user: true },
    });

    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (withdrawal.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ error: 'Withdrawal must be approved before marking as Paid' });
    }
    if (withdrawal.paymentStatus === 'PAID') {
      return res.status(400).json({ error: 'This withdrawal has already been marked as Paid' });
    }

    // Finalize payment: deduct from pendingBalance, increment totalWithdrawn
    const result = await prisma.$transaction(async (tx) => {
      const updatedReq = await tx.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: {
          paymentStatus: 'PAID',
          payoutReference: payoutReference.trim(),
          reviewNotes: reviewNotes || withdrawal.reviewNotes,
        },
      });

      await tx.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          pendingBalance: { decrement: withdrawal.amount },
          totalWithdrawn: { increment: withdrawal.amount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          userId: withdrawal.userId,
          transactionType: 'WITHDRAWAL_PAID',
          amount: -withdrawal.amount,
          currency: 'PKR',
          status: 'COMPLETED',
          relatedEntityId: withdrawal.id,
          actorId: req.admin!.id,
          actorName: req.admin!.username,
          reason: `Payout disbursed via ${withdrawal.paymentMethod} (Payout Ref: ${payoutReference.trim()})`,
          notes: reviewNotes,
        },
      });

      const payoutComment = reviewNotes?.trim() ? `\n\nAdmin Comment: ${reviewNotes.trim()}` : '';
      await tx.notification.create({
        data: {
          userId: withdrawal.userId,
          title: `Withdrawal Disbursed: PKR ${withdrawal.amount.toLocaleString()} 💸`,
          message: `Your payment of PKR ${withdrawal.amount.toLocaleString()} has been sent! Trx Reference: ${payoutReference.trim()}.${payoutComment}`,
          notificationType: 'WITHDRAWAL_STATUS',
        },
      });

      return updatedReq;
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'WITHDRAWAL_MARKED_PAID',
      entityType: 'WithdrawalRequest',
      entityId: withdrawalId,
      newState: { paymentStatus: 'PAID', payoutReference },
      reason: reviewNotes,
      ipAddress: req.ip,
    });

    res.json({ message: 'Withdrawal successfully marked as Paid!', withdrawal: result });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 10. SPIN WHEEL MANAGEMENT
// ==========================================

router.get('/spin', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const [prizes, entitlements, pendingMilestones, history] = await Promise.all([
      ensureOfficialSpinPrizes(),
      prisma.userSpinEntitlement.findMany({
        include: {
          user: { select: { id: true, name: true, phone: true } },
          assignedPrize: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.userSpinEntitlement.findMany({
        where: {
          requiresAdminReview: true,
          adminReviewed: false,
          remainingSpins: { gt: 0 },
        },
        include: {
          user: { select: { id: true, name: true, phone: true } },
          assignedPrize: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.spinHistory.findMany({
        include: {
          user: { select: { id: true, name: true, phone: true } },
          prize: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    const spinSetting = await prisma.siteSetting.findUnique({ where: { key: 'spin_enabled' } });

    res.json({
      isSpinEnabled: spinSetting?.value === 'true',
      prizes,
      entitlements,
      pendingMilestones,
      history,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/spin/assign', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const { userId, assignedPrizeId, totalSpins, isEligible } = z.object({
      userId: z.string().min(1, 'User is required'),
      assignedPrizeId: z.string().optional().nullable(),
      totalSpins: z.number().int().positive('Total spins must be at least 1'),
      isEligible: z.boolean().default(true),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let prize = null;
    if (assignedPrizeId) {
      prize = await prisma.spinPrize.findUnique({ where: { id: assignedPrizeId } });
    }

    const entitlement = await prisma.userSpinEntitlement.create({
      data: {
        userId,
        assignedPrizeId: prize?.id || null,
        totalSpins,
        remainingSpins: totalSpins,
        isEligible,
      },
    });

    await prisma.notification.create({
      data: {
        userId,
        title: `Royal Spin Entitlement Granted! 🎡`,
        message: `An administrator granted you ${totalSpins} royal spin(s)! Spin the wheel now to claim your reward.`,
        notificationType: 'SPIN_REWARD',
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'SPIN_ENTITLEMENT_ASSIGNED',
      entityType: 'UserSpinEntitlement',
      entityId: entitlement.id,
      newState: { userId, assignedPrize: prize?.name || 'Random', totalSpins },
      ipAddress: req.ip,
    });

    sendUserLiveCommand(userId, 'spin', { totalSpins });

    res.status(201).json({ message: 'Spin entitlement assigned successfully!', entitlement });
  } catch (err) {
    next(err);
  }
});

router.put('/spin/entitlements/:entitlementId/assign', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const entitlementId = req.params.entitlementId as string;
    const { assignedPrizeId } = z.object({
      assignedPrizeId: z.string().min(1, 'Assigned prize is required'),
    }).parse(req.body);

    const prize = await prisma.spinPrize.findUnique({ where: { id: assignedPrizeId } });
    if (!prize) return res.status(404).json({ error: 'Selected prize not found' });

    const entitlement = await prisma.userSpinEntitlement.update({
      where: { id: entitlementId },
      data: {
        assignedPrizeId,
        isEligible: true,
        adminReviewed: true,
      },
      include: { user: true, assignedPrize: true },
    });

    await prisma.notification.create({
      data: {
        userId: entitlement.userId,
        title: `Royal Spin Unlocked! 🎡`,
        message: `Your free milestone spin for ${entitlement.triggerReason || 'task progress'} has been prepared by administration! Visit the Royal Spin Wheel now to claim your prize!`,
        notificationType: 'SPIN_REWARD',
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'SPIN_PRIZE_ASSIGNED',
      entityType: 'UserSpinEntitlement',
      entityId: entitlement.id,
      newState: { assignedPrize: prize.name, isEligible: true },
      ipAddress: req.ip,
    });

    sendUserLiveCommand(entitlement.userId, 'spin', { entitlementId: entitlement.id, prize: prize.name });

    res.json({ message: `Prize ${prize.name} assigned and spin unlocked for ${entitlement.user.name}!`, entitlement });
  } catch (err) {
    next(err);
  }
});

router.post('/spin/prizes', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      prizeType: z.enum(['CASH', 'PHYSICAL', 'BONUS']),
      monetaryValue: z.number().nonnegative(),
      displayLabel: z.string().min(1),
      color: z.string().min(4),
      icon: z.string().optional(),
      inventory: z.number().int().nonnegative().default(999999),
      status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
    });
    const validated = schema.parse(req.body);

    const prize = await prisma.spinPrize.create({ data: validated });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'SPIN_PRIZE_CREATED',
      entityType: 'SpinPrize',
      entityId: prize.id,
      newState: prize,
      ipAddress: req.ip,
    });

    res.status(201).json({ message: 'Prize created successfully', prize });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 11. REFERRALS & TRANSACTIONS
// ==========================================

router.get('/referrals', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const search = (req.query.search as string || '').trim();
    let where: any = {};
    if (search) {
      const matchingUsers = await prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { referralCode: { contains: search, mode: 'insensitive' } },
            { id: { contains: search } },
          ],
        },
        select: { id: true },
        take: 100,
      });
      const matchedIds = matchingUsers.map((u) => u.id);
      where = {
        OR: [
          { referrerId: { in: matchedIds } },
          { referredId: { in: matchedIds } },
        ],
      };
    }

    const referrals = await prisma.referral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Resolve user names
    const userIds = Array.from(new Set([...referrals.map((r) => r.referrerId), ...referrals.map((r) => r.referredId)]));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, phone: true, referralCode: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const formatted = referrals.map((r) => ({
      id: r.id,
      referrer: userMap.get(r.referrerId) || { name: 'Unknown', phone: 'N/A' },
      referee: userMap.get(r.referredId) || { name: 'Unknown', phone: 'N/A' },
      qualifyingStatus: r.qualifyingStatus,
      rewardStatus: r.rewardStatus,
      rewardAmount: r.rewardAmount,
      createdAt: r.createdAt,
    }));

    res.json({ referrals: formatted });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const transactionType = (req.query.type as string || '').trim();
    const search = (req.query.search as string || '').trim();
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (transactionType) where.transactionType = transactionType;
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search } } },
            { user: { referralCode: { contains: search, mode: 'insensitive' } } },
            { user: { id: { contains: search } } },
            { reason: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            { id: { contains: search } },
          ],
        },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 12. ANNOUNCEMENTS & SETTINGS
// ==========================================

router.get('/announcements', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

router.post('/announcements', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const schema = z.object({
      title: z.string().min(2),
      content: z.string().min(5),
      audience: z.enum(['ALL', 'USERS']).default('ALL'),
      status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
    });
    const validated = schema.parse(req.body);

    const announcement = await prisma.announcement.create({ data: validated });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'ANNOUNCEMENT_CREATED',
      entityType: 'Announcement',
      entityId: announcement.id,
      newState: announcement,
      ipAddress: req.ip,
    });

    res.status(201).json({ message: 'Announcement published', announcement });
  } catch (err) {
    next(err);
  }
});

router.delete('/announcements/:id', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const id = req.params.id as string;
    await prisma.announcement.delete({ where: { id } });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'ANNOUNCEMENT_DELETED',
      entityType: 'Announcement',
      entityId: id,
      ipAddress: req.ip,
    });

    res.json({ message: 'Announcement deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/settings', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const settings = await prisma.siteSetting.findMany({
      orderBy: { category: 'asc' },
    });
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    let rawList: Array<{ key: string; value: any }> = [];

    if (Array.isArray(req.body)) {
      rawList = req.body;
    } else if (req.body && Array.isArray(req.body.settings)) {
      rawList = req.body.settings;
    } else if (req.body && typeof req.body === 'object') {
      rawList = Object.entries(req.body).map(([key, value]) => ({ key, value }));
    }

    if (!rawList.length) {
      return res.status(400).json({ error: 'No settings provided to update' });
    }

    const settings = rawList
      .filter((item) => item && typeof item.key === 'string' && item.key.trim() !== '')
      .map((item) => ({
        key: item.key.trim(),
        value: item.value === null || item.value === undefined ? '' : String(item.value),
      }));

    for (const item of settings) {
      await prisma.siteSetting.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: { key: item.key, value: item.value },
      });
    }

    logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'SITE_SETTINGS_UPDATED',
      entityType: 'SiteSetting',
      entityId: 'ALL',
      newState: settings,
      ipAddress: req.ip,
    }).catch(() => {});

    res.json({ message: 'Site settings updated successfully' });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 13. REPORTS & AUDIT LOGS
// ==========================================

router.get('/reports', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const [
      totalUsers,
      totalDeposited,
      totalPaidWithdrawals,
      totalPendingWithdrawals,
      totalTaskRewards,
      totalUnlockFees,
      totalReferralRewards,
      totalSpinRewards,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.depositRequest.aggregate({ where: { status: 'APPROVED' }, _sum: { amount: true } }),
      prisma.withdrawalRequest.aggregate({ where: { paymentStatus: 'PAID' }, _sum: { amount: true } }),
      prisma.withdrawalRequest.aggregate({ where: { approvalStatus: 'PENDING' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { transactionType: 'TASK_REWARD', status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { transactionType: 'TASK_UNLOCK_FEE', status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { transactionType: 'REFERRAL_REWARD', status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { transactionType: 'SPIN_REWARD', status: 'COMPLETED' }, _sum: { amount: true } }),
    ]);

    res.json({
      summary: {
        totalUsers,
        totalDeposited: totalDeposited._sum.amount || 0,
        totalPaidWithdrawals: totalPaidWithdrawals._sum.amount || 0,
        totalPendingWithdrawals: totalPendingWithdrawals._sum.amount || 0,
        totalTaskRewards: totalTaskRewards._sum.amount || 0,
        totalUnlockFees: Math.abs(totalUnlockFees._sum.amount || 0),
        totalReferralRewards: totalReferralRewards._sum.amount || 0,
        totalSpinRewards: totalSpinRewards._sum.amount || 0,
        platformNetYield: (totalDeposited._sum.amount || 0) + Math.abs(totalUnlockFees._sum.amount || 0) - (totalPaidWithdrawals._sum.amount || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/activity-logs', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '30', 10);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.adminAuditLog.count(),
    ]);

    res.json({
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 17. OFFICIAL ADMIN REFERRAL CODES MANAGEMENT
// ==========================================

router.get('/referral-codes', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const data = await getAdminReferralCodesOverview();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/referral-codes/generate', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const { count = 10 } = req.body;
    const generated = await generateAdditionalCodes(Math.min(Number(count) || 10, 100));

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'GENERATED_ADMIN_REFERRAL_CODES',
      entityType: 'AdminReferralCode',
      entityId: `batch_${Date.now()}`,
      newState: { count: generated.length, generated },
      reason: `Generated ${generated.length} official 6-letter invitation referral codes`,
      ipAddress: req.ip,
    });

    const data = await getAdminReferralCodesOverview();
    res.json({ message: `Successfully generated ${generated.length} new 6-letter referral codes!`, ...data });
  } catch (err) {
    next(err);
  }
});

router.post('/referral-codes/create', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const { code, notes } = z.object({
      code: z.string().regex(/^[a-zA-Z]{6}$/, 'Referral code must be exactly 6 alphabetical letters (e.g. lbhyfr)'),
      notes: z.string().optional(),
    }).parse(req.body);

    const formattedCode = code.trim().toLowerCase();
    await ensureAdminReferralCodes();

    await prisma.$executeRawUnsafe(`
      INSERT INTO "AdminReferralCode" ("id", "code", "status", "notes", "createdAt", "updatedAt")
      VALUES ($1, $2, 'AVAILABLE', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("code") DO NOTHING;
    `, `arc_custom_${Date.now()}`, formattedCode, notes || 'Custom 6-Letter Admin Code');

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'CREATED_CUSTOM_REFERRAL_CODE',
      entityType: 'AdminReferralCode',
      entityId: formattedCode,
      newState: { code: formattedCode },
      reason: notes || 'Admin added custom 6-letter invitation code',
      ipAddress: req.ip,
    });

    const data = await getAdminReferralCodesOverview();
    res.json({ message: `Code "${formattedCode}" created successfully!`, ...data });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 15. TELEGRAM BOT CLIENT MANAGEMENT & QUOTA
// ==========================================

router.get('/telegram-users', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const users = await getAllTelegramUsers();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

router.post('/telegram-users/:chatId/grant', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const chatId = req.params.chatId as string;
    const { amount = 10 } = req.body;
    const quotaToAdd = Math.max(1, parseInt(String(amount), 10) || 10);

    const result = await grantMoreCodesToTelegramUser(chatId, quotaToAdd);
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Failed to grant codes' });
    }

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'GRANTED_TELEGRAM_REFERRAL_CODES',
      entityType: 'TelegramUser',
      entityId: chatId,
      newState: result.user,
      reason: `Granted +${quotaToAdd} referral codes to Telegram user ${chatId}`,
      ipAddress: req.ip,
    });

    res.json({
      message: `Successfully granted +${quotaToAdd} invitation codes!`,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 16. MINI ADMIN MANAGEMENT & DYNAMIC 10-MIN OTP
// ==========================================

const createMiniAdminSchema = z.object({
  email: z.string().email('A valid Gmail or email address is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  username: z.string().optional(),
});

// List all Mini Admins with their current dynamic 10-minute OTP
router.get('/mini-admins', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const miniAdmins = await prisma.adminUser.findMany({
      where: { role: 'MINI_ADMIN' },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        otpSecret: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = miniAdmins.map((admin) => {
      let otpData = { otp: '------', secondsRemaining: 0, currentWindowIndex: 0 };
      if (admin.otpSecret) {
        otpData = getMiniAdminOtp(admin.otpSecret);
      }
      return {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        status: admin.status,
        currentOtp: otpData.otp,
        otpSecondsRemaining: otpData.secondsRemaining,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      };
    });

    res.json({ miniAdmins: result });
  } catch (err) {
    next(err);
  }
});

// Create new Mini Admin account
router.post('/mini-admins', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const { email, password, username } = createMiniAdminSchema.parse(req.body);
    const cleanEmail = email.trim().toLowerCase();
    const finalUsername = username && username.trim() ? username.trim() : cleanEmail;

    const existing = await prisma.adminUser.findFirst({
      where: {
        OR: [
          { username: finalUsername },
          { email: cleanEmail },
        ],
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'An admin with this email or username already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const otpSecret = generateOtpSecret();

    const newAdmin = await prisma.adminUser.create({
      data: {
        email: cleanEmail,
        username: finalUsername,
        passwordHash,
        role: 'MINI_ADMIN',
        status: 'ACTIVE',
        otpSecret,
      },
    });

    const otpData = getMiniAdminOtp(otpSecret);

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'CREATE_MINI_ADMIN',
      entityType: 'AdminUser',
      entityId: newAdmin.id,
      details: { email: cleanEmail, username: finalUsername },
      reason: `Master Admin created Mini Admin account ${cleanEmail}`,
      ipAddress: req.ip,
    });

    res.status(201).json({
      message: 'Mini Admin account created successfully',
      miniAdmin: {
        id: newAdmin.id,
        email: newAdmin.email,
        username: newAdmin.username,
        role: newAdmin.role,
        status: newAdmin.status,
        currentOtp: otpData.otp,
        otpSecondsRemaining: otpData.secondsRemaining,
        createdAt: newAdmin.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update Mini Admin account status (ACTIVE / SUSPENDED)
router.put('/mini-admins/:id/status', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const id = req.params.id as string;
    const { status } = z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED']),
    }).parse(req.body);

    const miniAdmin = await prisma.adminUser.findUnique({
      where: { id },
    });

    if (!miniAdmin || miniAdmin.role !== 'MINI_ADMIN') {
      return res.status(404).json({ error: 'Mini Admin account not found' });
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'UPDATE_MINI_ADMIN_STATUS',
      entityType: 'AdminUser',
      entityId: updated.id,
      previousState: { status: miniAdmin.status },
      newState: { status },
      reason: `Master Admin changed Mini Admin ${miniAdmin.email || miniAdmin.username} status to ${status}`,
      ipAddress: req.ip,
    });

    res.json({ message: `Mini Admin status updated to ${status}`, miniAdmin: updated });
  } catch (err) {
    next(err);
  }
});

// Reset Mini Admin account password
router.put('/mini-admins/:id/password', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const id = req.params.id as string;
    const { password } = z.object({
      password: z.string().min(6, 'Password must be at least 6 characters'),
    }).parse(req.body);

    const miniAdmin = await prisma.adminUser.findUnique({
      where: { id },
    });

    if (!miniAdmin || miniAdmin.role !== 'MINI_ADMIN') {
      return res.status(404).json({ error: 'Mini Admin account not found' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await prisma.adminUser.update({
      where: { id },
      data: { passwordHash },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'RESET_MINI_ADMIN_PASSWORD',
      entityType: 'AdminUser',
      entityId: id,
      reason: `Master Admin reset password for Mini Admin ${miniAdmin.email || miniAdmin.username}`,
      ipAddress: req.ip,
    });

    res.json({ message: 'Mini Admin password updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Regenerate dynamic OTP secret for a Mini Admin
router.post('/mini-admins/:id/regenerate-otp', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const id = req.params.id as string;
    const miniAdmin = await prisma.adminUser.findUnique({
      where: { id },
    });

    if (!miniAdmin || miniAdmin.role !== 'MINI_ADMIN') {
      return res.status(404).json({ error: 'Mini Admin account not found' });
    }

    const newSecret = generateOtpSecret();
    await prisma.adminUser.update({
      where: { id },
      data: { otpSecret: newSecret },
    });

    const otpData = getMiniAdminOtp(newSecret);

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'REGENERATE_MINI_ADMIN_OTP',
      entityType: 'AdminUser',
      entityId: id,
      reason: `Master Admin rotated OTP secret for Mini Admin ${miniAdmin.email || miniAdmin.username}`,
      ipAddress: req.ip,
    });

    res.json({
      message: 'New OTP secret rotated and generated successfully',
      currentOtp: otpData.otp,
      otpSecondsRemaining: otpData.secondsRemaining,
    });
  } catch (err) {
    next(err);
  }
});

// Delete Mini Admin account
router.delete('/mini-admins/:id', requireAdmin, requireSuperAdmin, async (req: AdminAuthRequest, res: Response, next) => {
  try {
    const id = req.params.id as string;
    const miniAdmin = await prisma.adminUser.findUnique({
      where: { id },
    });

    if (!miniAdmin || miniAdmin.role !== 'MINI_ADMIN') {
      return res.status(404).json({ error: 'Mini Admin account not found' });
    }

    await prisma.adminUser.delete({
      where: { id },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminUsername: req.admin!.username,
      action: 'DELETE_MINI_ADMIN',
      entityType: 'AdminUser',
      entityId: id,
      details: { email: miniAdmin.email, username: miniAdmin.username },
      reason: `Master Admin deleted Mini Admin account ${miniAdmin.email || miniAdmin.username}`,
      ipAddress: req.ip,
    });

    res.json({ message: 'Mini Admin account removed successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;

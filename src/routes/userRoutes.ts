import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * GET /api/user/dashboard
 * Aggregates complete dashboard data calculated strictly from database records
 */
router.get('/dashboard', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.id;

    // Fetch user with wallet
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parallel batch query for ultra-fast performance (single network roundtrip)
    const [
      levels,
      allApprovedProgress,
      approvedSubmissions,
      taskRewardTransactions,
      referralCount,
      entitlement,
      unreadNotificationsCount,
      recentTransactions,
      recentSubmissions,
      userLevelUnlocks,
    ] = await Promise.all([
      prisma.level.findMany({ orderBy: { levelNumber: 'asc' } }),
      prisma.userTaskProgress.findMany({
        where: { userId, status: 'APPROVED' },
        select: {
          task: {
            select: {
              id: true,
              levelId: true,
              taskNumber: true,
              isPaid: true,
              unlockFee: true,
              taskType: true,
              creditPoints: true,
            },
          },
        },
      }),
      prisma.taskSubmission.findMany({
        where: { userId, status: 'APPROVED' },
        select: {
          task: {
            select: {
              id: true,
              levelId: true,
            },
          },
        },
      }),
      prisma.walletTransaction.aggregate({
        where: { userId, transactionType: 'TASK_REWARD', status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.userSpinEntitlement.findFirst({
        where: { userId, isEligible: true, remainingSpins: { gt: 0 } },
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.taskSubmission.findMany({
        where: { userId },
        include: { task: { select: { title: true, taskNumber: true, rewardAmount: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.userLevelUnlock.findMany({
        where: { userId, isApproved: true },
        select: { levelNumber: true },
      }),
    ]);

    const approvedLevelNumbers = new Set(userLevelUnlocks.map((u) => u.levelNumber));

    // Aggregate unique approved tasks per level
    const approvedTasksByLevel = new Map<string, Set<string>>();
    for (const p of allApprovedProgress) {
      if (p.task?.levelId && p.task?.id) {
        if (!approvedTasksByLevel.has(p.task.levelId)) {
          approvedTasksByLevel.set(p.task.levelId, new Set());
        }
        approvedTasksByLevel.get(p.task.levelId)!.add(p.task.id);
      }
    }
    for (const s of approvedSubmissions) {
      if (s.task?.levelId && s.task?.id) {
        if (!approvedTasksByLevel.has(s.task.levelId)) {
          approvedTasksByLevel.set(s.task.levelId, new Set());
        }
        approvedTasksByLevel.get(s.task.levelId)!.add(s.task.id);
      }
    }

    let currentLevelNumber = 1;
    let currentLevelApprovedTasks = 0;
    let isAllLevelsCompleted = false;
    let completedLevelsCount = 0;
    let foundActiveLevel = false;

    for (const lvl of levels) {
      const approvedCount = approvedTasksByLevel.get(lvl.id)?.size || 0;
      const isLvlCompleted =
        lvl.levelNumber === 4
          ? approvedCount >= 1
          : approvedCount >= (lvl.requiredTaskCount || 10);
      const isLvlUnlocked =
        lvl.levelNumber <= 3
          ? true
          : approvedLevelNumbers.has(lvl.levelNumber);

      if (isLvlCompleted && isLvlUnlocked) {
        completedLevelsCount++;
        currentLevelNumber = lvl.levelNumber;
        currentLevelApprovedTasks = approvedCount;
      } else if (!foundActiveLevel) {
        if (isLvlUnlocked) {
          currentLevelNumber = lvl.levelNumber;
          currentLevelApprovedTasks = approvedCount;
        }
        foundActiveLevel = true;
      }
    }

    if (!foundActiveLevel && completedLevelsCount >= levels.length) {
      currentLevelNumber = levels.length || 10;
      currentLevelApprovedTasks = 10;
      isAllLevelsCompleted = true;
    }

    const currentLevel = levels.find((l) => l.levelNumber === currentLevelNumber) || levels[0];
    let totalApprovedTasksCount = 0;
    for (const set of approvedTasksByLevel.values()) {
      totalApprovedTasksCount += set.size;
    }
    const remainingTasksCount = Math.max(0, 100 - totalApprovedTasksCount);
    const totalTaskRewardsApproved = taskRewardTransactions._sum.amount || 0;

    const spinEligibility = {
      canSpin: !!entitlement,
      remainingSpins: entitlement?.remainingSpins || 0,
    };

    // Credit points are 100 upon joining and can only be increased or decreased by the Admin Panel
    const creditPoints = user.wallet?.creditPoints ?? 100;

    // 10% of total balance upon completing Level 1 (and 10% on every level, not cumulative 20%)
    const eligiblePercent = completedLevelsCount >= 1 ? 10 : 0;
    const availableBalance = user.wallet?.availableBalance || 0;
    const maxWithdrawableAmount = Math.floor((availableBalance * eligiblePercent) / 100);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        referralCode: user.referralCode,
        accountStatus: user.accountStatus,
        createdAt: user.createdAt,
      },
      wallet: user.wallet
        ? {
            ...user.wallet,
            creditPoints,
          }
        : {
            availableBalance: 0,
            pendingBalance: 0,
            totalEarned: 0,
            totalDeposited: 0,
            totalWithdrawn: 0,
            creditPoints: 100,
          },
      withdrawalEligibility: {
        completedLevelsCount,
        eligiblePercent,
        maxWithdrawableAmount,
        availableBalance,
      },
      levelProgress: {
        currentLevelNumber,
        levelTitle: currentLevel.title,
        levelDescription: currentLevel.description,
        approvedTasksCount: currentLevelApprovedTasks,
        totalLevelTasks: 10,
        isAllLevelsCompleted,
        completedLevelsCount,
      },
      taskStats: {
        totalApprovedTasks: totalApprovedTasksCount,
        totalTasks: 100,
        remainingTasks: remainingTasksCount,
        totalTaskRewards: totalTaskRewardsApproved,
        totalCreditPoints: creditPoints,
      },
      referralCount,
      spinEligibility,
      unreadNotificationsCount,
      recentTransactions,
      recentSubmissions,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/user/profile
 */
router.get('/profile', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        wallet: true,
        referredBy: {
          select: { name: true, phone: true },
        },
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { passwordHash: _removedPasswordHash, ...sanitizedUser } = user;
    res.json({ user: sanitizedUser });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/user/profile/password
 */
router.put('/profile/password', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: z.string().min(6, 'New password must be at least 6 characters'),
    });
    const validated = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isValid = await bcrypt.compare(validated.currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const newHash = await bcrypt.hash(validated.newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
